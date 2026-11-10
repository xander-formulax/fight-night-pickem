import { collapseWhitespace, nameKey } from './normalize.js';

const FIRST_PAGE = `
query ($board: [ID!], $cv: CompareValue!, $cols: [String!]) {
  boards(ids: $board) {
    items_page(limit: 100, query_params: { rules: [{ column_id: "name", compare_value: $cv, operator: contains_text }] }) {
      cursor
      items { id name column_values(ids: $cols) { id text value } }
    }
  }
}`;

const NEXT_PAGE = `
query ($cursor: String!, $cols: [String!]) {
  next_items_page(limit: 100, cursor: $cursor) {
    cursor
    items { id name column_values(ids: $cols) { id text value } }
  }
}`;

export function createMonday({ token, fetchImpl = fetch }) {
  if (!token) throw new Error('MONDAY_API_TOKEN is not set');

  async function gql(query, variables) {
    const res = await fetchImpl('https://api.monday.com/v2', {
      method: 'POST',
      headers: { Authorization: token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || json?.errors?.length || json?.error_message) {
      throw new Error(`monday API error ${res.status}: ${JSON.stringify(json?.errors || json?.error_message || json).slice(0, 500)}`);
    }
    return json.data;
  }

  return {
    /**
     * Items on the board whose name equals `projectName` after trim + whitespace collapse, case-insensitive.
     * Narrows server-side with contains_text on the first word, then compares exactly here.
     */
    async findItemsByName(boardId, projectName, { phoneColumn, emailColumn }) {
      const target = nameKey(projectName);
      const firstWord = collapseWhitespace(projectName).split(' ')[0];
      if (!firstWord) return [];
      const cols = [phoneColumn, emailColumn];

      const d = await gql(FIRST_PAGE, { board: [String(boardId)], cv: [firstWord], cols });
      let page = d?.boards?.[0]?.items_page;
      const items = [...(page?.items || [])];
      for (let i = 0; page?.cursor && i < 20; i++) {
        page = (await gql(NEXT_PAGE, { cursor: page.cursor, cols }))?.next_items_page;
        items.push(...(page?.items || []));
      }
      return items
        .filter((it) => nameKey(it.name) === target)
        .map((it) => ({
          id: it.id,
          name: collapseWhitespace(it.name),
          phone: readPhone(it.column_values.find((c) => c.id === phoneColumn)),
          email: readEmail(it.column_values.find((c) => c.id === emailColumn)),
        }));
    },
  };
}

function parse(v) {
  try { return v ? JSON.parse(v) : null; } catch { return null; }
}

function readPhone(col) {
  if (!col) return null;
  return parse(col.value)?.phone || col.text || null;
}

function readEmail(col) {
  if (!col) return null;
  return parse(col.value)?.email || col.text || null;
}
