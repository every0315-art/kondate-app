export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const { type, ingredients, recipes, imageBase64, imageType } = req.body || {}

  let messages, system, tools, toolChoice, extraHeaders = {}

  if (type === 'plan') {
    const recipeList = recipes?.length
      ? `\n登録レシピ:\n${recipes.map(r => `・${r.name}（材料: ${r.ingredients}）`).join('\n')}`
      : ''
    system = `あなたは家庭料理の献立アドバイザーです。ユーザーの食材と登録レシピを参考にして、3〜5日分の献立（朝・昼・夜）を提案してください。
以下のJSON形式のみで返答してください。前置きや説明は不要です。
[{"day":"1日目","meals":{"朝":"料理名","昼":"料理名","夜":"料理名"},"note":"一言コメント","missing":["不足食材1","不足食材2"]}]`
    messages = [{ role: 'user', content: `手持ち食材: ${ingredients?.join('、') || 'なし'}${recipeList}\n\n3〜5日分の献立をJSON形式で提案してください。登録レシピを優先的に使ってください。` }]

  } else if (type === 'search') {
    extraHeaders = { 'anthropic-beta': 'web-search-2025-03-05' }
    tools = [{ type: 'web_search_20250305', name: 'web_search' }]
    toolChoice = { type: 'any' }
    system = `あなたは料理レシピの検索アシスタントです。ウェブ検索で実際のレシピサイト（クックパッド、デリッシュキッチン、白ごはん.com等）からレシピを調べ、以下のJSON配列のみで返してください。前置き・説明不要。
重要: 材料は全て分量付きで記載。何人分かも必ず記載。
[{"name":"料理名","servings":"2人分","ingredients":"材料1 分量,材料2 分量,材料3 分量（全材料を省略せず）","steps":"作り方の要約（3〜5文）","source":"参考サイト名"}]`
    messages = [{ role: 'user', content: `「${ingredients?.join(' ')}」を使った家庭料理のレシピを2〜3件、実際のレシピサイトから検索してください。材料の分量と何人分かを必ず含めてJSON配列で返してください。` }]

  } else if (type === 'receipt') {
    system = `レシート画像から食材・食品のみを抽出し、JSON配列で返してください。食品以外（日用品、洗剤など）は除外。形式: ["食材1","食材2"] 前置き不要。`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'このレシートから料理に使える食材をJSON配列で抽出してください。' }
    ]}]

  } else if (type === 'recipe') {
    system = `料理レシピの画像から情報を抽出し、以下のJSON形式のみで返してください。前置き不要。材料は全て分量付きで省略せず記載。何人分かも記載。
{"name":"料理名","servings":"2人分","ingredients":"材料1 分量,材料2 分量,材料3 分量（全材料省略なし）","steps":"作り方の要約（2〜3文）"}
読み取れない場合: {"error":"読み取れませんでした"}`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'このレシピ画像から料理名・材料・作り方を抽出してJSON形式で返してください。' }
    ]}]
  }

  try {
    const body = { model: 'claude-haiku-4-5-20251001', max_tokens: 2000, system, messages }
    if (tools) body.tools = tools
    if (toolChoice) body.tool_choice = toolChoice

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        ...extraHeaders
      },
      body: JSON.stringify(body)
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'APIエラー')

    // textブロックを探す（web searchの場合は最後のブロックになる）
    const textBlock = (data.content || []).filter(b => b.type === 'text').pop()
    res.status(200).json({ text: textBlock?.text || '' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
