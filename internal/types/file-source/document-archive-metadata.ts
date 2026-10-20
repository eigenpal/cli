/** Response-only metadata shapes from the service contract. XML field casing is preserved. */
const text = { type: 'string' };
const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const identification = object({ DocumentId: text, ObjectStoreName: text }, ['DocumentId']);
const version = object(
  {
    MajorVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    MinorVersion: { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
  ['MajorVersion', 'MinorVersion']
);
const common = {
  DocumentIdentification: identification,
  DocumentClass: text,
  DocumentType: text,
  DocumentTitle: text,
  Version: version,
  CreatedDateTime: text,
  LastModificationDateTime: text,
  PartyId: text,
  DocumentState: text,
};
export const DOCUMENT_ARCHIVE_METADATA_VARIANTS = {
  GenericDocument: object(common, ['DocumentIdentification', 'DocumentClass', 'CreatedDateTime']),
  ContractDocument: object(
    {
      ...common,
      ProductIdentification: object({
        ApplicationId: text,
        ProductInstanceId: text,
        ContractNr: text,
      }),
      ArchiveProductCode: text,
      Description: text,
      SourceSystem: text,
      ExpirationDateTime: text,
      ValidFrom: text,
      BarCode: text,
    },
    ['DocumentIdentification', 'DocumentClass', 'Version', 'CreatedDateTime']
  ),
  ClientFinancialPlanDocument: object(
    {
      DocumentIdentification: identification,
      DateCreated: text,
      DocumentName: text,
      DocumentClass: text,
      FileName: text,
      PartyId: text,
      ValidTo: text,
    },
    ['DocumentIdentification', 'DateCreated', 'FileName', 'PartyId', 'ValidTo']
  ),
};
export const DOCUMENT_ARCHIVE_METADATA_SCHEMA = {
  anyOf: [
    { type: 'null' },
    ...Object.entries(DOCUMENT_ARCHIVE_METADATA_VARIANTS).map(([name, schema]) =>
      object({ [name]: schema }, [name])
    ),
  ],
};
