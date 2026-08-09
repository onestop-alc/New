import { stringSimilarity } from 'string-similarity-js';
import { SYNONYMS, FILLER, PROVINCES, CONFIG } from './feeds.js';

export function normalizeTitle(title: string): string {
  let normalized = title;
  
  // Replace synonyms with symbols
  for (const [word, symbol] of Object.entries(SYNONYMS)) {
    normalized = normalized.replace(new RegExp(word, 'g'), symbol);
  }

  // Remove filler words
  for (const word of FILLER) {
    normalized = normalized.replace(new RegExp(`\\b${word}\\b`, 'g'), '');
  }

  return normalized.trim();
}

export function extractTrgmKey(title: string): string {
  // Trgm key is simple normalization without symbols (letters and numbers only)
  return title.replace(/[^ก-๙a-zA-Z0-9]/g, '');
}

const THAI_NUMBERS: Record<string, number> = {
  "หนึ่ง": 1, "เอ็ด": 1, "สอง": 2, "ยี่": 2, "สาม": 3, "สี่": 4,
  "ห้า": 5, "หก": 6, "เจ็ด": 7, "แปด": 8, "เก้า": 9, "สิบ": 10,
  "ดับคาที่": 1
};

export function extractDeaths(title: string): number | null {
  const match = title.match(/(ดับ|เสียชีวิต|ตาย)\s*(\d+|[ก-๙]+)/);
  if (match) {
    const numStr = match[2];
    if (/\d+/.test(numStr)) return parseInt(numStr, 10);
    if (THAI_NUMBERS[numStr]) return THAI_NUMBERS[numStr];
    // Special case for 'ดับคาที่' without a number usually implies 1
    if (title.includes('ดับคาที่')) return 1;
  }
  return null;
}

export function extractInjuries(title: string): number | null {
  const match = title.match(/(บาดเจ็บ|สาหัส|เจ็บ)\s*(\d+|[ก-๙]+)/);
  if (match) {
    const numStr = match[2];
    if (/\d+/.test(numStr)) return parseInt(numStr, 10);
    if (THAI_NUMBERS[numStr]) return THAI_NUMBERS[numStr];
  }
  return null;
}

export function extractProvinces(text: string): string[] {
  const found = new Set<string>();
  for (const province of PROVINCES) {
    if (text.includes(province)) {
      if (province === 'กทม' || province === 'กทม.') {
        found.add('กรุงเทพมหานคร');
      } else if (province === 'โคราช') {
        found.add('นครราชสีมา');
      } else if (province === 'พัทยา') {
        found.add('ชลบุรี');
      } else if (province === 'หาดใหญ่') {
        found.add('สงขลา');
      } else {
        found.add(province);
      }
    }
  }
  return Array.from(found);
}

// Function to check if vehicles match (basic check)
export function getVehicleSignature(title: string): string {
  const v = [];
  if (title.includes('จยย.') || title.includes('จักรยานยนต์') || title.includes('มอเตอร์ไซค์')) v.push('2W');
  if (title.includes('เก๋ง') || title.includes('รถเก๋ง')) v.push('4W-C');
  if (title.includes('กระบะ') || title.includes('ปิกอัพ')) v.push('4W-P');
  if (title.includes('บรรทุก') || title.includes('สิบล้อ') || title.includes('พ่วง')) v.push('Truck');
  if (title.includes('ตู้')) v.push('Van');
  return v.sort().join(',');
}

export function isSameStory(
  titleA: string, titleB: string,
  provincesA: string[], provincesB: string[],
  deathsA: number | null, deathsB: number | null,
  injuriesA: number | null, injuriesB: number | null
): boolean {
  const normA = normalizeTitle(titleA);
  const normB = normalizeTitle(titleB);
  
  const similarity = stringSimilarity(normA, normB);
  
  if (similarity >= 0.5) return true; // High text similarity
  
  if (similarity >= CONFIG.SIMILARITY_THRESHOLD) {
    // Check signature
    const provMatch = provincesA.some(p => provincesB.includes(p)) || (provincesA.length === 0 && provincesB.length === 0);
    const deathMatch = deathsA === deathsB;
    const vehicleA = getVehicleSignature(titleA);
    const vehicleB = getVehicleSignature(titleB);
    const vehicleMatch = vehicleA === vehicleB && vehicleA !== '';
    
    if (provMatch && deathMatch && vehicleMatch) {
      return true;
    }
  }
  
  return false;
}
