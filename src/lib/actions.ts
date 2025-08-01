'use server';

import {
  generatePurchaseRecommendations as generatePurchaseRecommendationsFlow,
  type GeneratePurchaseRecommendationsInput,
  type GeneratePurchaseRecommendationsOutput,
} from '@/ai/flows/generate-purchase-recommendations';

export async function generatePurchaseRecommendations(
  input: GeneratePurchaseRecommendationsInput
): Promise<GeneratePurchaseRecommendationsOutput> {
  try {
    const recommendations = await generatePurchaseRecommendationsFlow(input);
    return recommendations;
  } catch (error) {
    console.error('Error generating AI recommendations:', error);
    throw new Error('Failed to generate AI-powered purchase recommendations.');
  }
}
