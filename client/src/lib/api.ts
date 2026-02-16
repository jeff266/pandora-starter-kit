let _workspaceId = '';
let _token = '';

export function setApiCredentials(workspaceId: string, token: string) {
  _workspaceId = workspaceId;
  _token = token;
}

async function request(method: string, path: string, body?: any) {
  const url = `/api/workspaces/${_workspaceId}${path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${_token}`,
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
  put: (path: string, body?: any) => request('PUT', path, body),
  patch: (path: string, body?: any) => request('PATCH', path, body),
  delete: (path: string) => request('DELETE', path),
  upload: (path: string, formData: FormData) => {
    const url = `/api/workspaces/${_workspaceId}${path}`;
    return fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${_token}` },
      body: formData,
    }).then(res => {
      if (!res.ok) return res.text().then(t => { throw new Error(t || `HTTP ${res.status}`); });
      return res.json();
    });
  },
};
