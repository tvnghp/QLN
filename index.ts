export interface Env {
  GH_TOKEN: string;
  REPO_OWNER: string;   // ví dụ: "your-user"
  REPO_NAME: string;    // ví dụ: "your-repo"
  REPO_BRANCH: string;  // ví dụ: "main"
  REPO_PATH: string;    // "data.xlsx"
  API_KEY: string;      // key gọi từ frontend
}
const GITHUB_API = "https://api.github.com";

function toBase64(ab: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(ab);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}
async function getSha(env: Env): Promise<string | null> {
  const url = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${encodeURIComponent(env.REPO_PATH)}?ref=${env.REPO_BRANCH}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${env.GH_TOKEN}`, "User-Agent": "cf-worker" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`get sha failed: ${r.status} ${await r.text()}`);
  const j: any = await r.json(); return j.sha || null;
}
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = { "Access-Control-Allow-Origin":"*", "Access-Control-Allow-Methods":"OPTIONS,POST", "Access-Control-Allow-Headers":"Content-Type,X-Api-Key" };
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    if (req.method !== "POST") return new Response(JSON.stringify({error:"Use POST"}), { status:405, headers:{...cors,"Content-Type":"application/json"} });

    const key = req.headers.get("X-Api-Key") || "";
    if (key !== env.API_KEY) return new Response(JSON.stringify({error:"Unauthorized"}), { status:401, headers:{...cors,"Content-Type":"application/json"} });

    let buf: ArrayBuffer | null = null, message = `update ${env.REPO_PATH}`, name="Auto Commit", email="actions@users.noreply.github.com";
    const ctype = req.headers.get("Content-Type") || "";
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const f = form.get("file");
      if (!(f instanceof File)) return new Response(JSON.stringify({error:"Missing file"}), { status:400, headers:{...cors,"Content-Type":"application/json"} });
      buf = await f.arrayBuffer();
      message = (form.get("message") as string) || message;
      name    = (form.get("authorName") as string) || name;
      email   = (form.get("authorEmail") as string) || email;
    } else {
      buf = await req.arrayBuffer();
    }
    if (!buf || buf.byteLength === 0) return new Response(JSON.stringify({error:"Empty payload"}), { status:400, headers:{...cors,"Content-Type":"application/json"} });

    const sha = await getSha(env);
    const body = { message, branch: env.REPO_BRANCH, content: toBase64(buf), sha: sha ?? undefined, committer: { name, email } };
    const putUrl = `${GITHUB_API}/repos/${env.REPO_OWNER}/${env.REPO_NAME}/contents/${encodeURIComponent(env.REPO_PATH)}`;
    const gh = await fetch(putUrl, { method:"PUT", headers:{ Authorization:`Bearer ${env.GH_TOKEN}`, "Content-Type":"application/json", "User-Agent":"cf-worker" }, body: JSON.stringify(body) });
    if (!gh.ok) return new Response(JSON.stringify({error:"GitHub commit failed", detail: await gh.text()}), { status:500, headers:{...cors,"Content-Type":"application/json"} });
    return new Response(JSON.stringify(await gh.json()), { headers:{...cors,"Content-Type":"application/json"} });
  }
};
