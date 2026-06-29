import Image from 'next/image'
import Link from 'next/link'

const FORMULA_X_URL = 'https://www.formulaxconsulting.com'

/**
 * The real Formula X logo (public/formula-x-logo.png), cropped tight to the pill.
 * Size it by setting a height in `className` (e.g. "h-12 w-auto").
 */
export function FormulaXLogo({ className = '' }: { className?: string }) {
  return (
    <Image
      src="/formula-x-logo.png"
      alt="Formula X"
      width={993}
      height={358}
      priority
      className={className}
    />
  )
}

/**
 * "Powered by [Formula X logo]" — a prominent, clickable credit that opens
 * formulaxconsulting.com in a new tab. Drop it at the bottom of any view.
 */
export function PoweredByFormulaX({
  className = '',
  logoClassName = 'h-12',
}: {
  className?: string
  logoClassName?: string
}) {
  return (
    <div className={`flex items-center justify-center gap-2.5 ${className}`}>
      <span className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
        Powered by
      </span>
      <Link
        href={FORMULA_X_URL}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Formula X Consulting — opens in a new tab"
        className="inline-flex items-center transition-opacity hover:opacity-90 hover:scale-[1.03]"
      >
        <FormulaXLogo className={`${logoClassName} w-auto`} />
      </Link>
    </div>
  )
}
