export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') return res.status(200).end()

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' })

  const { type, ingredients, recipes, imageBase64, imageType } = req.body || {}

  let messages, system

  if (type === 'plan') {
    const recipeList = recipes?.length
      ? `\n登録レシピ:\n${recipes.map(r => `・${r.name}（材料: ${r.ingredients}）`).join('\n')}`
      : ''
    system = `あなたは家庭料理の献立アドバイザーです。ユーザーの食材と登録レシピを参考にして、3〜5日分の献立（朝・昼・夜）を提案してください。
以下のJSON形式のみで返答してください。前置きや説明は不要です。
[{"day":"1日目","meals":{"朝":"料理名","昼":"料理名","夜":"料理名"},"note":"一言コメント","missing":["不足食材1","不足食材2"]}]`
    messages = [{ role: 'user', content: `手持ち食材: ${ingredients?.join('、') || 'なし'}${recipeList}\n\n3〜5日分の献立をJSON形式で提案してください。登録レシピを優先的に使ってください。` }]

  } else if (type === 'receipt') {
    system = `レシート画像から食材・食品のみを抽出し、JSON配列で返してください。食品以外（日用品、洗剤など）は除外。形式: ["食材1","食材2"] 前置き不要。`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'このレシートから料理に使える食材をJSON配列で抽出してください。' }
    ]}]

  } else if (type === 'recipe') {
    system = `料理レシピの画像から情報を抽出し、以下のJSON形式のみで返してください。前置き不要。
{"name":"料理名","ingredients":"材料1,材料2,材料3","steps":"作り方の要約"}
読み取れない場合: {"error":"読み取れませんでした"}`
    messages = [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: imageType, data: imageBase64 } },
      { type: 'text', text: 'このレシピ画像から料理名・材料・作り方を抽出してJSON形式で返してください。' }
    ]}]
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1500, system, messages })
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error?.message || 'APIエラー')
    res.status(200).json({ text: data.content?.[0]?.text || '' })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
}
