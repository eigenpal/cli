import type { TemplatePlaceholder } from '@eigenpal/types';
import Docxtemplater from 'docxtemplater';
import InspectModule from 'docxtemplater/js/inspect-module.js';
import PizZip from 'pizzip';

export interface PlaceholderExtractionResult {
  placeholders: TemplatePlaceholder[];
  warnings: string[];
}

/**
 * Extract placeholder names from a DOCX buffer using docxtemplater's InspectModule
 *
 * Uses docxtemplater's native tag parsing to find all {placeholder} tags,
 * including loops ({#items}...{/items}) and nested paths.
 * Returns structured placeholder information.
 *
 * @param buffer - DOCX file buffer
 * @returns Object with placeholders array and warnings array
 */
export function extractPlaceholders(buffer: Buffer): PlaceholderExtractionResult {
  const warnings: string[] = [];

  try {
    const zip = new PizZip(buffer);
    const inspectModule = new InspectModule();

    // Create docxtemplater instance with InspectModule to extract tags
    new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      modules: [inspectModule],
    });

    // Get all tags from the template
    const tags = inspectModule.getAllTags();

    // Convert tags object to placeholder array
    const placeholders = convertTagsToPlaceholders(tags);

    return {
      placeholders,
      warnings,
    };
  } catch (error) {
    // Extract meaningful error messages from docxtemplater
    const errorMessage = extractErrorMessage(error);
    if (errorMessage) {
      warnings.push(errorMessage);
    }

    // Return empty placeholders on error
    return { placeholders: [], warnings };
  }
}

/**
 * Recursively convert docxtemplater tag structure to placeholders
 *
 * The getAllTags() method returns a nested object structure where:
 * - Empty objects {} represent simple variables
 * - Objects with keys represent loops/sections with nested variables
 */
function convertTagsToPlaceholders(
  tags: Record<string, unknown>,
  parentPath: string[] = []
): TemplatePlaceholder[] {
  const placeholders: TemplatePlaceholder[] = [];

  for (const [key, value] of Object.entries(tags)) {
    const currentPath = [...parentPath, key];
    const fullName = currentPath.join('.');

    // Check if value is a non-empty object (loop/section with nested variables)
    const isObject = value && typeof value === 'object' && !Array.isArray(value);
    const hasNestedKeys = isObject && Object.keys(value as object).length > 0;

    if (hasNestedKeys) {
      // This is a loop/section - the key is a loop variable with nested fields
      placeholders.push({
        name: fullName,
        path: currentPath,
        kind: 'loop',
        type: 'array',
        required: true,
      });

      // Recursively process nested tags within the loop
      const nestedPlaceholders = convertTagsToPlaceholders(
        value as Record<string, unknown>,
        currentPath
      );
      placeholders.push(...nestedPlaceholders);
    } else {
      // Simple variable placeholder (empty object {} or primitive)
      placeholders.push({
        name: fullName,
        path: currentPath,
        kind: 'variable',
        type: 'string',
        required: true,
      });
    }
  }

  // Sort by name for consistent ordering
  return placeholders.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract meaningful error message from docxtemplater errors
 */
function extractErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;

  const err = error as {
    message?: string;
    properties?: {
      errors?: Array<{
        message?: string;
        properties?: {
          id?: string;
          explanation?: string;
          xtag?: string;
        };
      }>;
    };
  };

  const errors = err.properties?.errors;
  if (!errors || errors.length === 0) {
    return err.message || null;
  }

  const details = errors.map((e) => {
    const props = e.properties;
    const parts: string[] = [];

    if (props?.id) parts.push(props.id);
    if (props?.xtag) parts.push(`tag: ${props.xtag}`);
    if (props?.explanation) parts.push(props.explanation);
    else if (e.message) parts.push(e.message);

    return parts.join(' - ') || 'Unknown error';
  });

  return details.join('\n');
}
