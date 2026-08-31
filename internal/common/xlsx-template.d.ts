/**
 * Type declarations for xlsx-template
 */

interface XlsxTemplateOptions {
  moveImages?: boolean;
  subsituteAllTableRow?: boolean;
  moveSameLineImages?: boolean;
  imageRatio?: number;
  pushDownPageBreakOnTableSubstitution?: boolean;
  imageRootPath?: string | null;
  handleImageError?: ((error: Error) => void) | null;
}

interface GenerateOptions {
  type: 'nodebuffer' | 'base64' | 'uint8array' | 'arraybuffer' | 'blob';
}

declare class XlsxTemplate {
  constructor(data: Buffer, options?: XlsxTemplateOptions);

  loadTemplate(data: Buffer): void;
  substitute(sheetName: string | number, substitutions: Record<string, unknown>): void;
  substituteAll(substitutions: Record<string, unknown>): void;
  generate(options?: GenerateOptions): Buffer;
  generate(options: { type: 'base64' }): string;
  generate(options: { type: 'nodebuffer' }): Buffer;

  deleteSheet(sheetName: string | number): this;
  copySheet(sheetName: string | number, copyName?: string): this;
}

export = XlsxTemplate;
