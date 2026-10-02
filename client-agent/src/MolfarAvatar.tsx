import type { ReactNode } from "react"

/** Molfar's face, round. The files are static assets of the shell (the agent
 *  page is served from the same origin): 128 px for the small sizes, 512 px
 *  for the big one on the welcome screen. */
export function MolfarAvatar(props: { size: number; className?: string }): ReactNode {
  const src = props.size > 48 ? "/client/molfar-512.webp" : "/client/molfar-128.webp"
  return (
    <img
      src={src}
      alt="Molfar"
      width={props.size}
      height={props.size}
      draggable={false}
      className={`shrink-0 rounded-full object-cover ring-1 ring-border ${props.className ?? ""}`}
      style={{ width: `${props.size}px`, height: `${props.size}px` }}
    />
  )
}
