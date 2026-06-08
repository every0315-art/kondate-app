export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const { type, ingredients, recipes, imageBase64, imageType } = req.body || {}

  let messages, system, tools, toolChoice, extraHeaders = {}

  if (type === 'plan') {
    const { meals, servings, priority } = req.body || {}
    const mealList = (Array.isArray(meals) && meals.length) ? meals : ['朝','昼','夜']
    const servingsNum = Number(servings) || 2
    const priorityList = Array.isArray(priority) ? priority : []
    const topRecipes = (recipes || []).slice(0, 10)
    const recipeList = topRecipes.length ? `\n登録レシピ:${topRecipes.map(r => r.name).join('、')}` : ''
    const priorityNote = priorityList.length ? `\n優先使用食材:${priorityList.join('、')}（必ずこれらを使う料理を含める）` : ''
    const mealExample = mealList.map(m => `"${m}":"料理名"`).join(',')
    system = `献立アドバイザー。3日分の献立をJSONのみで返す。前置き不要。対象の食事:${mealList.join('・')}、${servingsNum}人分。
[{"day":"1日目","meals":{${mealExample}},"note":"コメント","missing":["不足食材"]}]`
    messages = [{ role: 'user', content: `食材:${(ingredients || []).join('、') || 'なし'}${recipeList}${priorityNote}\n3日分の献立をJSONで。登録レシピ優先。対象の食事は${mealList.join('・')}のみ。` }]

  } else if (type === 'search') {
    system = `あなたは料理レシピの専門家です。指定された食材を使った家庭料理のレシピを3件提案してください。
以下のJSON配列のみで返してください。前置き・説明不要。材料は全て分量付きで省略せず記載。
[{"name":"料理名","servings":"2人分","ingredients":"材料1 分量,材料2 分量,材料3 分量","steps":"作り方（手順を3〜5文で）","source":"定番レシピ"}]`
    messages = [{ role: 'user', content: `「${ingredients?.join('・')}」を使った美味しい家庭料理のレシピを3件、材料の分量と何人分かを含めてJSON配列で返してください。` }]

  } else if (type === 'receipt') {
    system = `レシート画像から食材・食品のみを抽出し、JSON配列で返してください。食品以外（日用品、洗剤など）は除外。形式: ["食材1","食材2"] 前置き不要。`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'このレシートから料理に使える食材をJSON配列で抽出してください。' }
    ]}]

  } else if (type === 'fridge') {
    system = `冷蔵庫の写真から見える食材・食品を全て抽出し、JSON配列で返してください。野菜、肉、魚、乳製品、飲み物、調味料など見えるものを全て含めてください。食材名のみ、数量や状態は不要。形式: ["食材1","食材2"] 前置き不要。`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'この冷蔵庫の写真から見える食材・食品を全てJSON配列で抽出してください。' }
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
    const maxTokensMap = { plan: 1200, search: 1200, receipt: 300, fridge: 400, recipe: 400 }
    const body = { model: 'claude-haiku-4-5-20251001', max_tokens: maxTokensMap[type] || 800, system, messages }
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
