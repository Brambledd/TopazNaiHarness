import { useCallback, useEffect, useState } from 'react'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { NS } from './locales.ts'
import type { TurnImage } from './turn-images.ts'
import css from './TurnImages.module.css'

/** Injected image channel: the session-authorized durable URL loader. */
export interface TurnImagesInjected {
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
}

/** Matched turn images plus the locale seat and the injected image loader. */
export type TurnImagesProps = {
  matched: readonly TurnImage[]
} & PropsLocale<typeof NS> & InjectFace<TurnImagesInjected>

/** One thumbnail: self-healing URL load with a retry arm, mirroring the row's rules. */
function TurnImageThumb({ image, loadImage, alt, preview, failed, open }: {
  image: TurnImage
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  alt: string
  preview: string
  failed: string
  open: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const reload = useCallback(() => { setAttempt(value => value + 1) }, [])

  useEffect(() => {
    let alive = true
    setError(false)
    loadImage(image.attachment).then(
      (value) => { if (alive) setUrl(value) },
      () => { if (alive) setError(true) },
    )
    return () => { alive = false }
  }, [image, loadImage, attempt])

  if (error) {
    return (
      <button type="button" className={css.loadFailed} onClick={reload}>{failed}</button>
    )
  }
  return (
    <button
      type="button"
      className={css.thumbButton}
      title={preview}
      aria-label={preview}
      onClick={() => { if (url !== null) open() }}
    >
      {url === null
        ? <span className={css.loading} aria-hidden />
        : <img className={css.thumbnail} src={url} alt={alt} onError={reload} />}
    </button>
  )
}

/**
 * Render one turn's generated NovelAI images under the closing assistant
 * message: a bounded thumbnail strip with the shared click-to-zoom lightbox.
 * @param props - matched turn images, locale seat, and the image loader.
 * @returns the produced-images tail row.
 */
export function TurnImages({ matched, t, loadImage }: TurnImagesProps) {
  const [zoomed, setZoomed] = useState<number | null>(null)
  const close = useCallback(() => { setZoomed(null) }, [])

  useEffect(() => {
    if (zoomed === null) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') setZoomed(null)
    }
    window.addEventListener('keydown', onKey)
    return () =>{  window.removeEventListener('keydown', onKey) }
  }, [zoomed])

  const current = zoomed === null ? undefined : matched[zoomed]
  return (
    <div className={css.row} data-tool="novelai_generate-images">
      {matched.map((image, index) => (
        <TurnImageThumb
          key={image.attachment.attachmentId}
          image={image}
          loadImage={loadImage}
          alt={image.attachment.name ?? t('row.title')}
          preview={t('row.preview')}
          failed={t('row.loadFailed')}
          open={() => { setZoomed(index) }}
        />
      ))}
      {current !== undefined
        ? <TurnLightbox image={current} t={t} loadImage={loadImage} onClose={close} />
        : null}
    </div>
  )
}

function TurnLightbox({ image, t, loadImage, onClose }: {
  image: TurnImage
  t: TurnImagesProps['t']
  loadImage: (attachment: ImageAttachmentRef) => Promise<string>
  onClose: () => void
}): React.ReactNode {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    loadImage(image.attachment).then(
      (value) => { if (alive) setUrl(value) },
      () => { if (alive) setUrl(null) },
    )
    return () => { alive = false }
  }, [image, loadImage])
  return (
    <div
      className={css.lightbox}
      role="dialog"
      aria-modal="true"
      aria-label={t('row.preview')}
      onClick={onClose}
    >
      {url !== null
        ? <img className={css.zoomImage} src={url} alt={image.attachment.name ?? t('row.title')} />
        : null}
      <button type="button" className={css.closeButton} aria-label={t('row.close')}>×</button>
    </div>
  )
}
