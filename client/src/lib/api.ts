let _workspaceId = '';
let _apiKey = '';

export function setApiCredentials(workspaceId: string, apiKey: string) {
  _workspaceId = workspaceId;
  _apiKey = apiKey;
}

async function request(method: string, path: string, body?: any) {
  const url = `/api/workspaces/${_workspaceId}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${_apiKey}`,
  };
  if (body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = {
  get: (path: string) => request('GET', path),
  post: (path: string, body?: any) => request('POST', path, body),
  patch: (path: string, body?: any) => request('PATCH', path, body),
  delete: (path: string) => request('DELETE', path),
};

export async function verifyWorkspace(workspaceId: string, apiKey: string): Promise<{ name: string }> {
  const res = await fetch(`/api/workspaces/${workspaceId}`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error('Invalid workspace ID or API key');
  const data = await res.json();
  return { name: data.name || data.workspace?.name || workspaceId.slice(0, 8) };
}
