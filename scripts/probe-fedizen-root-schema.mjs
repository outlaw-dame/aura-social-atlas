#!/usr/bin/env node
/**
 * Bounded, anonymous GraphQL ROOT-operation metadata probe.
 * It does not retrieve user data or enable introspection on the server.
 * Introspection may be disabled; this is a legitimate "unavailable" outcome.
 *
 * node scripts/probe-fedizen-root-schema.mjs --self-test
 * node scripts/probe-fedizen-root-schema.mjs
 */
import { createHash } from 'node:crypto';
import { strict as assert } from 'node:assert';

const ENDPOINT = 'https://fedizen.net/api/graphql';
const LIMIT = 512 * 1024;
const DOCUMENT = `query AtlasReadOnlyRootContract {
  __schema {
    queryType {
      name
      fields { name type { kind name ofType { kind name ofType { kind name } } } args { name type { kind name ofType { kind name ofType { kind name } } } } }
    }
    mutationType {
      name
      fields { name type { kind name ofType { kind name ofType { kind name } } } args { name type { kind name ofType { kind name ofType { kind name } } } } }
    }
  }
  feedFilters: __type(name: "FeedFilters") {
    kind inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  postContentInput: __type(name: "PostContentInput") {
    kind inputFields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  meType: __type(name: "Me") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  userType: __type(name: "User") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  activityConnectionType: __type(name: "ActivityConnection") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  activityEdgeType: __type(name: "ActivityEdge") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  characterType: __type(name: "Character") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
  profileType: __type(name: "Profile") {
    kind fields { name type { kind name ofType { kind name ofType { kind name } } } }
  }
}`;
const FOCUS = new Set([
  'me', 'user', 'users', 'feedActivities', 'notifications',
  'activity', 'post', 'posts', 'thread', 'threads', 'categories',
  'createPost', 'updatePost', 'deletePost', 'like', 'unlike',
  'boost', 'unboost', 'follow', 'unfollow', 'bookmark',
]);

function validName(name) {
  return typeof name === 'string' && /^[A-Za-z_][A-Za-z_0-9]{0,100}$/.test(name);
}
function typeBrief(t) {
  if (!t || typeof t !== 'object' || !['NON_NULL','LIST','SCALAR','ENUM','INPUT_OBJECT','OBJECT','INTERFACE','UNION'].includes(t.kind)) return null;
  return {
    kind: t.kind,
    name: validName(t.name) ? t.name : (validName(t.ofType?.name) ? t.ofType.name :
      (validName(t.ofType?.ofType?.name) ? t.ofType.ofType.name : null)),
  };
}

function inspectInput(t) {
  if (t === undefined || t === null) return null;
  if (!t || t.kind !== 'INPUT_OBJECT' || !Array.isArray(t.inputFields) ||
    t.inputFields.length > 120) return null;
  const fields = [];
  for (const f of t.inputFields) {
    if (!f || !validName(f.name)) return null;
    const type = typeBrief(f.type);
    if (!type) return null;
    fields.push({ name: f.name, type });
  }
  return fields.sort((a,b) => a.name.localeCompare(b.name));
}

function inspectObjectType(t) {
  if (t === undefined || t === null) return null;
  if (!t || t.kind !== 'OBJECT' || !Array.isArray(t.fields) ||
    t.fields.length > 180) return null;
  const fields = [];
  for (const f of t.fields) {
    if (!f || !validName(f.name)) return null;
    const type = typeBrief(f.type);
    if (!type) return null;
    fields.push({ name: f.name, type });
  }
  return fields.sort((a,b) => a.name.localeCompare(b.name));
}

function inspectRoot(root) {
  if (!root || typeof root !== 'object' || !Array.isArray(root.fields) ||
    root.fields.length > 1000 || !validName(root.name)) return null;
  const fields = [];
  for (const item of root.fields) {
    if (!item || !validName(item.name) || !Array.isArray(item.args) || item.args.length > 60) return null;
    const args = [];
    for (const a of item.args) {
      if (!a || !validName(a.name)) return null;
      const t = a.type;
      if (!t || typeof t !== 'object' || !['NON_NULL','LIST','SCALAR','ENUM','INPUT_OBJECT'].includes(t.kind)) return null;
      args.push({ name: a.name, kind: t.kind, type: validName(t.name) ? t.name : (validName(t.ofType?.name) ? t.ofType.name : null) });
    }
    const returnType = typeBrief(item.type);
    fields.push({ name: item.name, args, returnType });
  }
  return { name: root.name, fields: fields.sort((a,b) => a.name.localeCompare(b.name)) };
}

export function summarizeSchema(payload) {
  const schema = payload?.data?.__schema;
  if (payload?.errors != null || !schema || typeof schema !== 'object') return null;
  const queries = inspectRoot(schema.queryType);
  const mutations = schema.mutationType === null ? { name: null, fields: [] } : inspectRoot(schema.mutationType);
  if (!queries || !mutations) return null;
  const filterFields = inspectInput(payload?.data?.feedFilters);
  const postContentFields = inspectInput(payload?.data?.postContentInput);
  const nestedTypes = {
    Me: inspectObjectType(payload?.data?.meType),
    User: inspectObjectType(payload?.data?.userType),
    ActivityConnection: inspectObjectType(payload?.data?.activityConnectionType),
    ActivityEdge: inspectObjectType(payload?.data?.activityEdgeType),
    Character: inspectObjectType(payload?.data?.characterType),
    Profile: inspectObjectType(payload?.data?.profileType),
  };
  const normalized = JSON.stringify({ queries, mutations, filterFields, postContentFields, nestedTypes });
  const focused = roots => roots.fields.filter(x => FOCUS.has(x.name));
  return {
    status: 'root-introspection-available',
    schemaFingerprint: createHash('sha256').update(normalized).digest('hex'),
    queryType: queries.name,
    mutationType: mutations.name,
    queryFieldCount: queries.fields.length,
    mutationFieldCount: mutations.fields.length,
    candidateQueryFields: focused(queries),
    candidateMutationFields: focused(mutations),
    feedFiltersInput: filterFields,
    postContentInput: postContentFields,
    nestedTypes,
    // Counts and names are schema metadata only, never user content.
  };
}

async function responseBody(response) {
  const reported = response.headers.get('content-length');
  if (reported !== null && Number(reported) > LIMIT) {
    await response.body?.cancel().catch(() => {});
    throw Error('size');
  }
  if (!response.body) throw Error('body');
  const reader = response.body.getReader();
  let total = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > LIMIT) throw Error('size');
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal:true }).decode(data));
}

async function live() {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify({ query: DOCUMENT }),
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    console.log(JSON.stringify({ status: 'not-available', httpStatus: response.status }));
    return;
  }
  const summary = summarizeSchema(await responseBody(response));
  console.log(JSON.stringify(summary ?? { status: 'not-available', httpStatus: response.status }));
}

async function test() {
  const fixture = { data: { __schema: {
    queryType: { name: 'RootQueryType', fields: [
      { name: 'feedActivities', args: [{name:'first',type:{kind:'SCALAR',name:'Int'}}] },
      { name: 'me', args: [] },
    ] },
    mutationType: { name: 'RootMutationType', fields: [{name:'createPost',args:[],type:{kind:'OBJECT',name:'Post'}}] },
  }, feedFilters:{kind:'INPUT_OBJECT', inputFields:[{ name:'feedName', type:{kind:'SCALAR',name:'String'} }]},
    postContentInput:{kind:'INPUT_OBJECT',inputFields:[]} } };
  const result = summarizeSchema(fixture);
  assert.equal(result?.status, 'root-introspection-available');
  assert.equal(result.queryFieldCount,2);
  assert.deepEqual(result.candidateQueryFields.map(x=>x.name), ['feedActivities','me']);
  assert.equal(result.candidateMutationFields[0].name,'createPost');
  assert.equal(result.candidateMutationFields[0].returnType.name,'Post');
  assert.equal(result.feedFiltersInput[0].name,'feedName');
  assert.equal(summarizeSchema({ ...fixture, errors:[{message:'secret'}] }),null);
  assert.equal(summarizeSchema({ data:{__schema:{queryType:{name:'Query',fields:[{name:'bad name',args:[]}]},mutationType:null}} }),null);
  assert.equal(summarizeSchema(null), null);
  console.log('PASS: root GraphQL metadata summary self-tests');
}

if (process.argv.includes('--self-test')) await test();
else {
  try { await live(); }
  catch { console.log(JSON.stringify({ status:'not-available', reason:'transport-or-invalid-response' })); }
}
