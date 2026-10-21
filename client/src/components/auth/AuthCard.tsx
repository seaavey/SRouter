import type { ReactNode } from "react"

type AuthCardProps = {
  /** The body of the card: the form, or the retry notice. */
  children: ReactNode
  /** The line under the title. */
  description: string
  /** The title of the card. */
  title: string
}

/** The card body: a title, one line of context, and what the card holds. */
export default function AuthCard({
  children,
  description,
  title,
}: AuthCardProps) {
  return (
    <div className="flex flex-col gap-6 p-5 sm:p-7">
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-xl font-medium tracking-tight text-foreground">
          {title}
        </h1>
        <p className="m-0 text-sm leading-[1.45] text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </div>
  )
}
