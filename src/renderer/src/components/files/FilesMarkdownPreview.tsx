// Files Tab · Markdown 预览：react-markdown + GFM。原始 HTML 不渲染（库默认，天然防注入）；
// 相对路径图片解析到项目内后经 dc-media 协议流式读取（越界 / 非图片不渲染）；链接一律拦截
// 默认跳转，http/https/mailto 交给系统浏览器，其余（锚点 / 相对链接）不动作。
import { useMemo } from 'react'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { buildFilesMediaUrl } from '@shared/files'
import { resolveWithinProject } from '@shared/files-path'
import { imageMimeOf } from '@shared/git'

function hasScheme(url: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')
}

function decodeMaybe(url: string): string {
  try {
    return decodeURIComponent(url)
  } catch {
    return url
  }
}

export function FilesMarkdownPreview({
  path,
  content,
  projectRoot
}: {
  path: string
  content: string
  projectRoot: string
}): React.JSX.Element {
  const components = useMemo<Components>(() => {
    const dir = path.slice(0, path.lastIndexOf('/'))
    return {
      a: ({ href, children, ...rest }) => (
        <a
          {...rest}
          href={href}
          onClick={(e) => {
            e.preventDefault()
            if (href !== undefined && /^(https?|mailto):/i.test(href)) {
              void window.api.openExternal(href)
            }
          }}
        >
          {children}
        </a>
      ),
      img: ({ src, alt, ...rest }) => {
        let resolved = typeof src === 'string' ? src : undefined
        if (resolved !== undefined && !hasScheme(resolved)) {
          const logical = resolveWithinProject(projectRoot, dir + '/' + decodeMaybe(resolved))
          const mime = logical === null ? null : imageMimeOf(logical)
          resolved =
            logical !== null && mime !== null
              ? buildFilesMediaUrl(projectRoot, logical, mime)
              : undefined
        }
        return <img {...rest} src={resolved} alt={alt ?? ''} />
      }
    }
  }, [path, projectRoot])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-deepest">
      <div className="files-md-preview prose prose-sm mx-auto max-w-[760px] px-8 py-6">
        <Markdown remarkPlugins={[remarkGfm]} components={components}>
          {content}
        </Markdown>
      </div>
    </div>
  )
}
