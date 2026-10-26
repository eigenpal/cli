import { parse } from '@babel/parser';
import type { CallExpression, Expression, ObjectExpression, ObjectProperty } from '@babel/types';

function agentCall(source: string): {
  call: CallExpression;
  outer: Expression;
  filesystem: boolean;
  filesystemCalls: CallExpression[];
} {
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'] });
  const creators = new Set<string>();
  for (const statement of ast.program.body)
    if (
      statement.type === 'ImportDeclaration' &&
      statement.source.value === '@eigenpal/automations'
    )
      for (const item of statement.specifiers)
        if (
          item.type === 'ImportSpecifier' &&
          (item.imported.type === 'Identifier' ? item.imported.name : item.imported.value) ===
            'createAgent'
        )
          creators.add(item.local.name);
  const exported = ast.program.body.find((node) => node.type === 'ExportDefaultDeclaration');
  const outer = exported?.type === 'ExportDefaultDeclaration' ? exported.declaration : undefined;
  const constants = new Map<string, Expression>();
  for (const statement of ast.program.body) {
    const declaration =
      statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    if (declaration?.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue;
    for (const item of declaration.declarations)
      if (item.id.type === 'Identifier' && item.init)
        constants.set(item.id.name, item.init as Expression);
  }
  let call = outer;
  let filesystem = false;
  const filesystemCalls: CallExpression[] = [];
  const seen = new Set<string>();
  while (call) {
    if (call.type === 'Identifier' && constants.has(call.name) && !seen.has(call.name)) {
      seen.add(call.name);
      call = constants.get(call.name);
    } else if (
      call.type === 'CallExpression' &&
      call.callee.type === 'MemberExpression' &&
      call.callee.object.type !== 'Super' &&
      !call.callee.computed &&
      call.callee.property.type === 'Identifier' &&
      ['withFilesystem', 'defineEvaluator', 'defineEvalPass'].includes(call.callee.property.name)
    ) {
      if (call.callee.property.name === 'withFilesystem') filesystemCalls.push(call);
      filesystem ||= call.callee.property.name === 'withFilesystem';
      call = call.callee.object;
    } else break;
  }

  if (
    call?.type !== 'CallExpression' ||
    call.callee.type !== 'Identifier' ||
    !creators.has(call.callee.name) ||
    call.arguments[0]?.type !== 'ObjectExpression'
  )
    throw new Error(
      'Edit this definition in agent.ts: expected a default createAgent call with literal options'
    );
  return { call, outer: outer as Expression, filesystem, filesystemCalls };
}
function agentOptions(source: string): ObjectExpression {
  return agentCall(source).call.arguments[0] as ObjectExpression;
}

/** Add the capability to a literal definition without rewriting its contents. */
export function enableAgentSourceFilesystem(source: string): string {
  const { call, outer, filesystem } = agentCall(source);
  // Validate even when appending: spreads can hide explicit mode choices.
  properties(call.arguments[0] as ObjectExpression);
  if (filesystem || agentSourcePropertyExpression(source, 'filesystem') !== undefined)
    throw new Error('Agent already declares filesystem; review its intended mode');
  return source.slice(0, outer.end!) + '.withFilesystem()' + source.slice(outer.end!);
}
function properties(object: ObjectExpression): ObjectProperty[] {
  if (object.properties.some((property) => property.type !== 'ObjectProperty' || property.computed))
    throw new Error(
      'Edit this definition in agent.ts: computed or spread options cannot be updated safely'
    );
  return object.properties as ObjectProperty[];
}
function propertyName(property: ObjectProperty): string | undefined {
  return property.key.type === 'Identifier'
    ? property.key.name
    : property.key.type === 'StringLiteral'
      ? property.key.value
      : undefined;
}
export function agentSourcePropertyExpression(source: string, name: string): string | undefined {
  const property = properties(agentOptions(source)).find((p) => propertyName(p) === name);
  return property ? source.slice(property.value.start!, property.value.end!) : undefined;
}

/** Exact source ranges preserve imported helpers, callbacks, comments and unrelated formatting. */
export function updateAgentSourceProperty(
  source: string,
  path: string[],
  expression: string
): string {
  if (!path.length) throw new Error('A source property path is required');
  let object = agentOptions(source);
  for (let index = 0; index < path.length; index++) {
    const key = path[index];
    const list = properties(object);
    const property = list.find((p) => propertyName(p) === key);
    if (index === path.length - 1 && property)
      return (
        source.slice(0, property.value.start!) + expression + source.slice(property.value.end!)
      );
    if (property) {
      if (property.value.type !== 'ObjectExpression')
        throw new Error(`Edit ${key} in agent.ts: expected literal configuration`);
      object = property.value;
      continue;
    }
    let nested = expression;
    for (const child of path.slice(index + 1).reverse())
      nested = `{ ${JSON.stringify(child)}: ${nested} }`;
    const last = list.at(-1);
    const position = last?.end ?? object.start! + 1;
    const insert = `${last ? ',' : ''}\n  ${JSON.stringify(key)}: ${nested}`;
    return source.slice(0, position) + insert + source.slice(position);
  }
  throw new Error('Invalid source update');
}

/** Trigger toggles affect the source draft; email aliases and helper expressions remain intact. */
export function updateAgentSourceTriggers(
  source: string,
  patch: { api?: boolean; email?: boolean }
): string {
  let next = source;
  if (patch.api !== undefined)
    next = updateAgentSourceProperty(next, ['triggers', 'api'], JSON.stringify(patch.api));
  if (patch.email !== undefined)
    next = updateAgentSourceProperty(
      next,
      ['triggers', 'email', 'enabled'],
      JSON.stringify(patch.email)
    );
  return next;
}

export function readAgentSourceTriggerFlags(source: string): { api: boolean; email: boolean } {
  const options = agentOptions(source);
  const triggers = properties(options).find((p) => propertyName(p) === 'triggers');
  if (!triggers) return { api: true, email: false };
  if (triggers.value.type !== 'ObjectExpression')
    throw new Error('Edit dynamic trigger configuration in agent.ts');
  const api = properties(triggers.value).find((p) => propertyName(p) === 'api');
  const email = properties(triggers.value).find((p) => propertyName(p) === 'email');
  if (api && api.value.type !== 'BooleanLiteral')
    throw new Error('Edit dynamic API trigger in agent.ts');
  let enabled = false;
  if (email) {
    if (email.value.type !== 'ObjectExpression')
      throw new Error('Edit dynamic email trigger in agent.ts');
    const fields = properties(email.value);
    const explicit = fields.find((p) => propertyName(p) === 'enabled');
    if (explicit && explicit.value.type !== 'BooleanLiteral')
      throw new Error('Edit dynamic email trigger in agent.ts');
    enabled = explicit?.value.type === 'BooleanLiteral' ? explicit.value.value : true;
  }
  return { api: api?.value.type === 'BooleanLiteral' ? api.value.value : true, email: !!enabled };
}

/** Operator source conversion: remove a literal field without rewriting other options. */
export function removeAgentSourceProperty(source: string, name: string): string {
  const object = agentOptions(source);
  const list = properties(object);
  const index = list.findIndex((property) => propertyName(property) === name);
  if (index < 0) return source;
  const property = list[index];
  const ast = parse(source, { sourceType: 'module', plugins: ['typescript'], tokens: true });
  const commas = (ast.tokens ?? []).filter(
    (token) => typeof token.type !== 'string' && token.type.label === ','
  );
  const next = list[index + 1];
  const following = commas.find(
    (token) => token.start! >= property.end! && token.end! <= (next?.start ?? object.end! - 1)
  );
  if (following) return source.slice(0, property.start!) + source.slice(following.end!);
  const previous = list[index - 1];
  const preceding = previous
    ? commas.find((token) => token.start! >= previous.end! && token.end! <= property.start!)
    : undefined;
  return source.slice(0, preceding?.start ?? property.start!) + source.slice(property.end!);
}

/** Append a known fluent chain to the default export, preserving its exact source. */
export function appendAgentSourceMethods(source: string, methods: string): string {
  const { outer } = agentCall(source);
  return source.slice(0, outer.end!) + methods + source.slice(outer.end!);
}

/** Operator source conversion inserts trusted TypeScript expressions without stringifying imports. */
export function setAgentSourceExpression(source: string, name: string, expression: string): string {
  parse(`const value = (${expression});`, { sourceType: 'module', plugins: ['typescript'] });
  const object = agentOptions(source);
  const existing = properties(object).find((property) => propertyName(property) === name);
  if (existing)
    return source.slice(0, existing.value.start!) + expression + source.slice(existing.value.end!);
  return (
    source.slice(0, object.start! + 1) +
    `${JSON.stringify(name)}:${expression},` +
    source.slice(object.start! + 1)
  );
}

/** Preserve literal filesystem options while adding migrated skill imports before evaluations. */
export function addAgentSourceSkills(source: string, expression: string): string {
  parse(`const value=(${expression});`, { sourceType: 'module', plugins: ['typescript'] });
  const { call, filesystemCalls } = agentCall(source);
  const modifier = filesystemCalls[0];
  if (!modifier)
    return (
      source.slice(0, call.end!) +
      `.withFilesystem({skills:${expression}})` +
      source.slice(call.end!)
    );
  const options = modifier.arguments[0];
  if (options && options.type !== 'ObjectExpression')
    throw new Error('Review nonliteral filesystem options before migrating skills');
  const existing = options
    ? properties(options).find((property) => propertyName(property) === 'skills')
    : undefined;
  const skills = existing
    ? `{...(${source.slice(existing.value.start!, existing.value.end!)}),...(${expression})}`
    : expression;
  if (!options)
    return (
      source.slice(0, modifier.end! - 1) + `{skills:${skills}}` + source.slice(modifier.end! - 1)
    );
  const text = source.slice(options.start!, options.end!);
  const updated = existing
    ? text.slice(0, existing.value.start! - options.start!) +
      skills +
      text.slice(existing.value.end! - options.start!)
    : `{skills:${skills},${text.slice(1)}`;
  return source.slice(0, options.start!) + updated + source.slice(options.end!);
}
