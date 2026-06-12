/**
 * Human-facing API path notation. OpenAPI and route registration keep `{param}`;
 * docs and UI show `:param` (Express-style).
 */

/** Convert an OpenAPI path template to display form, e.g. `/runs/{id}` → `/runs/:id`. */
export function displayApiPath(path: string): string {
  return path.replace(/\{([^{}/]+)\}/g, ':$1');
}

/** Rewrite `/api/v1/.../{param}` segments inside prose to `:param`. */
export function displayApiPathsInText(text: string): string {
  let result = text;
  let prev: string;
  do {
    prev = result;
    result = result.replace(/(\/api\/v1\/[^\s`'"({]*)\{([^{}/]+)\}/g, '$1:$2');
  } while (result !== prev);
  return result;
}
