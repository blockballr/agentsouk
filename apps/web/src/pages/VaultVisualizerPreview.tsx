import { useState } from 'react'
import { VaultVisualizer } from '../components/VaultVisualizer'
import { Btn, Stack, Txt } from '../components/souk'

// Standalone preview of the VaultVisualizer component. Not wired into any page;
// visit /vault-visualizer-preview to see it. Remove before shipping if unused.
export default function VaultVisualizerPreview() {
  const [state, setState] = useState<'earning' | 'losing' | 'nearLimit'>('earning')
  const presets = {
    earning: { balanceA: 55, balanceB: 45, valueUsd: 10500, floorUsd: 9000, maxLossBps: 500, maxSlippageBps: 100, drawdownUsedBps: 80, price: 1.04, trades: [{ side: 'A' as const, amount: 1200 }, { side: 'B' as const, amount: 800 }, { side: 'A' as const, amount: 400 }] },
    losing: { balanceA: 70, balanceB: 30, valueUsd: 9200, floorUsd: 9000, maxLossBps: 500, maxSlippageBps: 100, drawdownUsedBps: 320, price: 0.94, trades: [{ side: 'B' as const, amount: 1500 }, { side: 'A' as const, amount: 600 }] },
    nearLimit: { balanceA: 80, balanceB: 20, valueUsd: 9050, floorUsd: 9000, maxLossBps: 500, maxSlippageBps: 100, drawdownUsedBps: 480, price: 0.91, trades: [{ side: 'B' as const, amount: 2000 }] },
  }
  return (
    <div className="mx-auto max-w-[480px] p-6">
      <Stack gap={12}>
        <Txt size={18} lead={24} weight="bold" tone="ink">VaultVisualizer preview</Txt>
        <div className="flex gap-2">
          <Btn kind={state === 'earning' ? 'primary' : 'off'} onClick={() => setState('earning')}>Earning</Btn>
          <Btn kind={state === 'losing' ? 'primary' : 'off'} onClick={() => setState('losing')}>Losing</Btn>
          <Btn kind={state === 'nearLimit' ? 'primary' : 'off'} onClick={() => setState('nearLimit')}>Near limit</Btn>
        </div>
        <VaultVisualizer state={presets[state]} />
      </Stack>
    </div>
  )
}