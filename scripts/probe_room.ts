import { createDouyinSource } from '../server/src/danmaku/douyin'

async function main() {
  const roomId = process.argv[2] ?? '7456029449519467272'
  const source = createDouyinSource({ debug: true })
  const types: Record<string, number> = {}
  const collected: any[] = []
  const sub = await source.subscribe({
    roomId,
    onItem: (item) => {
      types[item.text ?? 'unknown'] = (types[item.text ?? 'unknown'] ?? 0) + 1
      collected.push(item)
    },
  })

  await new Promise((r) => setTimeout(r, 30000))
  console.log(`room=${roomId} collected=${collected.length}`)
  if (collected.length) {
    console.log('first 3:', JSON.stringify(collected.slice(0, 3), null, 2))
  }
  await sub.stop()
  process.exit(0)
}
main().catch((e) => {
  console.error('FAIL', e.message)
  process.exit(1)
})
