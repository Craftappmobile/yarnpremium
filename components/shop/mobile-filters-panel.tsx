"use client"

import * as Dialog from "@radix-ui/react-dialog"
import { X } from "lucide-react"
import type { ReactNode } from "react"
import type { useReturnFocus } from "./use-return-focus"

interface MobileFiltersPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: ReturnType<typeof useReturnFocus>
  /** «Показати N товарів» on the button that closes the panel. */
  resultLabel: string
  children: ReactNode
}

/** Phones: the filters slide in from the left; the desktop sidebar is hidden there. */
export function MobileFiltersPanel({ open, onOpenChange, returnFocus, resultLabel, children }: MobileFiltersPanelProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          {...returnFocus}
          className="fixed inset-y-0 left-0 z-50 flex w-[88%] max-w-sm flex-col bg-zinc-50 shadow-xl data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left lg:hidden"
        >
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
            <Dialog.Title className="text-sm font-semibold uppercase tracking-wider">Фільтри</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Закрити фільтри" className="rounded-full p-2 hover:bg-zinc-100">
                <X className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-5">{children}</div>
          <div className="border-t border-zinc-200 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <Dialog.Close asChild>
              <button type="button" className="w-full rounded-lg bg-zinc-900 py-3 text-sm font-semibold text-white hover:bg-zinc-800">
                {resultLabel}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
