import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import draft7MetaSchema from 'ajv/dist/refs/json-schema-draft-07.json';

/**
 * One AJV instance shared by every validation call site (server `/run` handlers,
 * worker pre-execution check, agent inference session, CLI pre-flight). Same
 * options + same registered keywords mean the four sites cannot disagree on a
 * verdict.
 *
 * Configured for:
 * - runtime data validation (`compile` then call the validator)
 * - authored-schema meta-validation (`validateSchema`)
 * - the `x-eigenpal-type: 'file'` extension
 * - schemas declaring `$schema: "https://json-schema.org/draft-07/schema#"`
 *   (the canonical TLS URI most generators emit today) — AJV ships draft-07
 *   pre-registered under the `http://` URI only, so we alias.
 */
// `verbose: true` populates `error.data` with the offending value so we can
// quote it back to the user (`got "critical"`). Negligible cost.
export const eigenpalAjv = new Ajv({ allErrors: true, strict: false, verbose: true });
addFormats(eigenpalAjv);
eigenpalAjv.addKeyword({ keyword: 'x-eigenpal-type', metaSchema: { type: 'string' } });
eigenpalAjv.addMetaSchema({ ...draft7MetaSchema, $id: 'https://json-schema.org/draft-07/schema#' });
