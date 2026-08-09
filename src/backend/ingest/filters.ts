import { STRONG_ALCOHOL, WEAK_ALCOHOL, INCIDENT_TERMS, NEGATIVE_TERMS } from './feeds.js';

export interface FilterResult {
  passed: boolean;
  confidence: 'high' | 'medium' | 'none';
  reason: string;
}

export function classifyArticle(title: string, summary: string): FilterResult {
  const fullText = `${title} ${summary}`.toLowerCase();
  const titleLower = title.toLowerCase();

  // 1. Check for negative terms first
  const negativeMatch = NEGATIVE_TERMS.find(term => fullText.includes(term));
  if (negativeMatch) {
    // Exception: If the title has a strong alcohol term, we still accept it
    const strongTitleMatch = STRONG_ALCOHOL.find(term => titleLower.includes(term));
    if (!strongTitleMatch) {
      return { passed: false, confidence: 'none', reason: `Negative term: ${negativeMatch}` };
    }
  }

  // 2. Check for strong alcohol terms
  const strongMatch = STRONG_ALCOHOL.find(term => fullText.includes(term));
  if (strongMatch) {
    return { passed: true, confidence: 'high', reason: `Strong term: ${strongMatch}` };
  }

  // 3. Check for weak alcohol terms + incident terms
  const weakMatch = WEAK_ALCOHOL.find(term => fullText.includes(term));
  if (weakMatch) {
    const incidentMatch = INCIDENT_TERMS.find(term => fullText.includes(term));
    if (incidentMatch) {
      return { passed: true, confidence: 'medium', reason: `Weak term (${weakMatch}) + Incident (${incidentMatch})` };
    }
  }

  return { passed: false, confidence: 'none', reason: 'No matching criteria' };
}
