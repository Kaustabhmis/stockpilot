'use server';

/**
 * @fileOverview AI-powered purchase recommendations flow.
 *
 * - generatePurchaseRecommendations - A function that generates purchase recommendations.
 * - GeneratePurchaseRecommendationsInput - The input type for the generatePurchaseRecommendations function.
 * - GeneratePurchaseRecommendationsOutput - The return type for the generatePurchaseRecommendations function.
 */

import {ai} from '@/ai/genkit';
import {z} from 'genkit';

const GeneratePurchaseRecommendationsInputSchema = z.object({
  materials: z.array(
    z.object({
      materialCode: z.string().describe('The material code of the item.'),
      materialName: z.string().describe('The name of the material.'),
      currentQuantity: z
        .number()
        .describe('The current quantity of the material in stock.'),
      safetyStock: z.number().describe('The safety stock level for the material.'),
      reorderPoint: z.number().describe('The reorder point for the material.'),
      leadTimeDays: z.number().describe('The lead time in days for the material.'),
      costPerUnit: z.number().describe('The cost per unit of the material.'),
      dailyDemand: z.number().describe('The estimated daily demand for the material.'),
    })
  ).describe('An array of materials with their details.'),
});
export type GeneratePurchaseRecommendationsInput = z.infer<
  typeof GeneratePurchaseRecommendationsInputSchema
>;

const GeneratePurchaseRecommendationsOutputSchema = z.array(
  z.object({
    materialCode: z.string().describe('The material code of the item.'),
    materialName: z.string().describe('The name of the material.'),
    suggestedQuantity: z
      .number()
      .describe('The suggested quantity to purchase.'),
    priority: z.enum(['critical', 'high', 'medium', 'low']).describe('The priority of the purchase recommendation.'),
    reasoning: z.string().describe('The reasoning behind the purchase recommendation.'),
  })
);
export type GeneratePurchaseRecommendationsOutput = z.infer<
  typeof GeneratePurchaseRecommendationsOutputSchema
>;

export async function generatePurchaseRecommendations(
  input: GeneratePurchaseRecommendationsInput
): Promise<GeneratePurchaseRecommendationsOutput> {
  return generatePurchaseRecommendationsFlow(input);
}

const prompt = ai.definePrompt({
  name: 'generatePurchaseRecommendationsPrompt',
  input: {schema: GeneratePurchaseRecommendationsInputSchema},
  output: {schema: GeneratePurchaseRecommendationsOutputSchema},
  prompt: `You are an AI assistant that provides purchase recommendations for inventory management.

  Based on the current stock levels, demand forecasts, lead times, and safety stock levels, provide a list of suggested quantities to purchase for each material.

  Prioritize the recommendations based on urgency and potential stockouts.

  Materials:
  {{#each materials}}
  - Material Code: {{materialCode}}, Material Name: {{materialName}}, Current Quantity: {{currentQuantity}}, Safety Stock: {{safetyStock}}, Reorder Point: {{reorderPoint}}, Lead Time (Days): {{leadTimeDays}}, Cost Per Unit: {{costPerUnit}}, Daily Demand: {{dailyDemand}}
  {{/each}}
  
  Provide the output in JSON format.
  `,
});

const generatePurchaseRecommendationsFlow = ai.defineFlow(
  {
    name: 'generatePurchaseRecommendationsFlow',
    inputSchema: GeneratePurchaseRecommendationsInputSchema,
    outputSchema: GeneratePurchaseRecommendationsOutputSchema,
  },
  async input => {
    const {output} = await prompt(input);
    return output!;
  }
);
