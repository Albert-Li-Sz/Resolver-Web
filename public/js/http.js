/** Proxy HTML and empty responses produce useful messages without echoing bodies. */
export async function readJSONResponse(response, fallback = '服务器响应无效，请稍后重试') {
  let data;
  try { data = JSON.parse(await response.text()); }
  catch { throw Object.assign(new Error(`${fallback}（HTTP ${response.status}）`), { status: response.status }); }
  if (!response.ok) throw Object.assign(new Error(data?.error || fallback), { status: response.status, payload: data });
  return data;
}
