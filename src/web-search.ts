import { config } from "./config.js"

interface SearchResult {
  title: string
  url: string
  description: string
}

export async function exaSearch(query: string): Promise<SearchResult[]> {
  const key = config.EXA_API_KEY
  if (!key) throw new Error("EXA_API_KEY not configured")

  const res = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
    },
    body: JSON.stringify({
      query,
      numResults: 5,
      contents: {
        highlights: { maxCharacters: 200 },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Exa API error: ${res.status}`)

  const data = await res.json() as {
    results?: Array<{
      title: string
      url: string
      highlights?: string[]
    }>
  }

  return (data.results ?? []).slice(0, 5).map(r => ({
    title: r.title,
    url: r.url,
    description: r.highlights?.join(" ") ?? "",
  }))
}
