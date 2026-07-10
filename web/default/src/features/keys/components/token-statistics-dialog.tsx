/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { VChart } from '@visactor/react-vchart'
import { BarChart3, Coins, Hash, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { getDashboardChartColors } from '@/features/dashboard/lib/charts'
import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { useChartTheme } from '@/lib/use-chart-theme'
import { formatNumber } from '@/lib/format'
import { VCHART_OPTION } from '@/lib/vchart'
import { cn } from '@/lib/utils'

import { getTokenStat } from '../api'
import { ERROR_MESSAGES } from '../constants'
import type { ApiKey, TokenStatTimeRange, TokenUsageStat } from '../types'

interface TokenStatisticsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRow: ApiKey | null
}

const TIME_RANGE_OPTIONS: { value: TokenStatTimeRange; label: string }[] = [
  { value: '1d', label: '1 Day' },
  { value: '7d', label: '7 Days' },
  { value: '30d', label: '30 Days' },
  { value: 'all', label: 'All Time' },
]

function rangeToTimestamps(range: TokenStatTimeRange): {
  start: number
  end: number
} {
  const end = Math.floor(Date.now() / 1000)
  if (range === 'all') return { start: 0, end: 0 }
  const daysByRange: Record<Exclude<TokenStatTimeRange, 'all'>, number> = {
    '1d': 1,
    '7d': 7,
    '30d': 30,
  }
  const days = daysByRange[range as Exclude<TokenStatTimeRange, 'all'>]
  return { start: end - days * 86400, end }
}

// Format a bucket unix-timestamp for the chart x-axis. Buckets are aligned to
// hour or day by the backend; show the matching granularity.
function formatBucket(bucket: number, range: TokenStatTimeRange): string {
  const date = new Date(bucket * 1000)
  if (range === '1d') {
    return date.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    })
  }
  return date.toLocaleDateString(undefined, {
    month: '2-digit',
    day: '2-digit',
  })
}

function formatTokenCount(value: number): string {
  return formatNumber(value)
}

export function TokenStatisticsDialog({
  open,
  onOpenChange,
  currentRow,
}: TokenStatisticsDialogProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()
  const [range, setRange] = useState<TokenStatTimeRange>('7d')
  const [stat, setStat] = useState<TokenUsageStat | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  const tokenId = currentRow?.id

  useEffect(() => {
    if (!open || !tokenId) {
      setStat(null)
      setError(false)
      return
    }
    let cancelled = false
    const { start, end } = rangeToTimestamps(range)
    setLoading(true)
    setError(false)
    void (async () => {
      try {
        const res = await getTokenStat(tokenId, start, end)
        if (cancelled) return
        if (res.success && res.data) {
          setStat(res.data)
        } else {
          setStat(null)
          setError(true)
        }
      } catch {
        if (!cancelled) {
          setStat(null)
          setError(true)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tokenId, range])

  const timelineSpec = useMemo(() => {
    if (!stat || (stat.timeline?.length ?? 0) === 0) return null
    const values = stat.timeline.map((b) => ({
      Time: formatBucket(b.bucket, range),
      Tokens: b.total_tokens,
      Requests: b.request_count,
    }))
    return {
      type: 'area' as const,
      data: [{ id: 'timeline', values }],
      xField: 'Time',
      yField: 'Tokens',
      stack: false,
      legends: { visible: false },
      tooltip: { mark: { content: [] } },
      title: { visible: true, text: t('Token Usage Trend') },
      background: { fill: 'transparent' },
      animation: true,
    }
  }, [stat, range, t])

  const modelSpec = useMemo(() => {
    if (!stat || (stat.by_model?.length ?? 0) === 0) return null
    const values = stat.by_model.map((m) => ({
      Model: m.model_name,
      Tokens: m.total_tokens,
    }))
    const colors = getDashboardChartColors(values.length)
    return {
      type: 'bar' as const,
      data: [{ id: 'byModel', values }],
      xField: 'Model',
      yField: 'Tokens',
      seriesField: 'Model',
      legends: { visible: false, selectMode: 'single' as const },
      color: {
        type: 'ordinal' as const,
        domain: values.map((v) => v.Model),
        range: colors,
      },
      tooltip: { mark: { content: [] } },
      title: { visible: true, text: t('Usage by Model') },
      background: { fill: 'transparent' },
      animation: true,
    }
  }, [stat, t])

  const timelineKey = [
    'timeline',
    range,
    stat?.timeline?.length ?? 0,
    resolvedTheme,
  ].join('-')
  const modelKey = [
    'byModel',
    stat?.by_model?.length ?? 0,
    resolvedTheme,
  ].join('-')

  const totals = stat?.totals
  const hasData = !!totals && (totals.total_tokens > 0 || totals.request_count > 0)

  const renderChartBody = (
    chartKey: string,
    spec: Record<string, unknown> | null
  ) => {
    if (loading) return <Skeleton className='h-full w-full' />
    if (error) {
      return (
        <div className='text-muted-foreground flex h-full items-center justify-center text-sm'>
          {t(ERROR_MESSAGES.LOAD_FAILED)}
        </div>
      )
    }
    if (themeReady && spec) {
      return (
        <VChart
          key={chartKey}
          spec={{
            ...spec,
            theme: resolvedTheme === 'dark' ? 'dark' : 'light',
            background: 'transparent',
          }}
          option={VCHART_OPTION}
        />
      )
    }
    return null
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('Usage Statistics')}
      description={currentRow?.name ? `"${currentRow.name}"` : undefined}
      contentClassName='sm:max-w-3xl'
      contentHeight='auto'
      bodyClassName='space-y-4'
      footer={
        <Button variant='outline' onClick={() => onOpenChange(false)}>
          {t('Close')}
        </Button>
      }
    >
      {/* Time range selector */}
      <div className='grid grid-cols-2 gap-2 sm:flex'>
        {TIME_RANGE_OPTIONS.map((opt) => (
          <Button
            key={opt.value}
            type='button'
            size='sm'
            variant={range === opt.value ? 'default' : 'outline'}
            onClick={() => setRange(opt.value)}
            className={cn(
              'flex-1',
              range === opt.value && 'ring-ring ring-2 ring-offset-2'
            )}
          >
            {t(opt.label)}
          </Button>
        ))}
      </div>

      {/* Summary cards */}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
        <div className='rounded-lg border p-3'>
          <StatCard
            title={t('Total Tokens')}
            value={totals ? formatTokenCount(totals.total_tokens) : ''}
            description={t('Prompt + completion')}
            icon={Hash}
            tone='gray'
            loading={loading}
            error={error}
            details={
              totals
                ? [
                    {
                      label: t('Prompt'),
                      value: formatTokenCount(totals.prompt_tokens),
                    },
                    {
                      label: t('Completion'),
                      value: formatTokenCount(totals.completion_tokens),
                    },
                  ]
                : undefined
            }
          />
        </div>
        <div className='rounded-lg border p-3'>
          <StatCard
            title={t('Requests')}
            value={totals ? formatTokenCount(totals.request_count) : ''}
            description={t('Total API calls')}
            icon={BarChart3}
            tone='teal'
            loading={loading}
            error={error}
          />
        </div>
        <div className='rounded-lg border p-3'>
          <StatCard
            title={t('Quota Used')}
            value={totals ? formatTokenCount(totals.quota) : ''}
            description={t('Consumed quota')}
            icon={Coins}
            tone='rose'
            loading={loading}
            error={error}
          />
        </div>
      </div>

      {/* Charts */}
      {!loading && !error && !hasData ? (
        <Empty className='border-none p-0'>
          <EmptyHeader>
            <EmptyMedia variant='icon'>
              <Timer className='size-6' />
            </EmptyMedia>
            <EmptyTitle>{t('No Usage Data')}</EmptyTitle>
            <EmptyDescription>
              {t('No usage recorded for this key in the selected time range.')}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className='space-y-4'>
          {/* Timeline chart */}
          <div className='overflow-hidden rounded-lg border'>
            <div className='h-[260px] p-1.5 sm:h-72 sm:p-2'>
              {renderChartBody(timelineKey, timelineSpec)}
            </div>
          </div>

          {/* By-model chart */}
          <div className='overflow-hidden rounded-lg border'>
            <div className='h-[260px] p-1.5 sm:h-72 sm:p-2'>
              {renderChartBody(modelKey, modelSpec)}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  )
}
