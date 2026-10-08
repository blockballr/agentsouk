// read the key spec nodes of the Agent Souk UX-Reimagined figma file and dump
// their text, so the design doc lives in the repo instead of the api calls
const pat = process.env.FIGMA_PAT
const FILE = '04e6ftTME8ZNJcUM4HTvZC'
const ids = ['12:39', '12:37', '12:245', '12:377', '12:640', '12:812', '12:994', '12:13', '12:16', '12:19', '12:22']
const res = await fetch(
  `https://api.figma.com/v1/files/${FILE}/nodes?ids=${ids.join(',')}&depth=6`,
  { headers: { 'X-Figma-Token': pat } },
)
const j = await res.json()
for (const [id, n] of Object.entries(j.nodes)) {
  const d = n.document
  let text = ''
  const collect = (node) => {
    if (node.type === 'TEXT' && node.characters) text += node.characters + '\n'
    ;(node.children || []).forEach(collect)
  }
  collect(d)
  console.log(`===== ${d.name} [${id}]`)
  console.log(text.slice(0, 2600))
}
