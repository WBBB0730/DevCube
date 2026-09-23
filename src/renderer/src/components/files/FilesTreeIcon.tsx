// 文件树文件行图标：按 `filesTreeIconKind` 选图——一律用 lucide 的**裸物件**图标（内容本身是什么就画什么），
// 不用「文件 + 角标」系列；PDF 用自绘的「圆角方框 + Acrobat 卷纹」（lucide 没有），未知二进制才用 `File`
// （它的意思正是「只知道是个文件」）。颜色随文件的工作区 Git 状态（同 FileTreeFileRow），见 DESIGN.md。
import {
  Braces,
  Code,
  File,
  Film,
  Image,
  Music,
  Package2,
  Presentation,
  Table2,
  Terminal,
  Type
} from 'lucide-react'
import { filesTreeIconKind, type FilesTreeIconKind } from '@shared/files-tree-icon'

/**
 * 自绘 PDF：外壳取 lucide `Square` 的圆角方框（同 `SquarePlay` 一族），框内居中放一笔
 * Acrobat 风格卷纹（原是 16 格的单笔 stroke 路径，缩放 0.8 后居中进框）。
 * 卷纹线宽经缩放后约 1.4，比外框细一档，小尺寸下不糊。
 */
function SquarePdf(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path
        transform="translate(5.55 5.6) scale(0.8)"
        strokeWidth="1.75"
        d="M2.8 14.34c1.81-1.25 3.02-3.16 3.91-5.5c.9-2.33 1.86-4.33 1.44-6.63c-.06-.36-.57-.73-.83-.7c-1.02.06-.95 1.21-.85 1.9c.24 1.71 1.56 3.7 2.84 5.56c1.27 1.87 2.32 2.16 3.78 2.26c.5.03 1.25-.14 1.37-.58c.77-2.8-9.02-.54-12.28 2.08c-.4.33-.86 1-.6 1.46c.2.36.87.4 1.23.15h0Z"
      />
    </svg>
  )
}

const ICONS: Record<FilesTreeIconKind, React.ComponentType<React.SVGProps<SVGSVGElement>>> = {
  image: Image,
  pdf: SquarePdf,
  slides: Presentation,
  audio: Music,
  video: Film,
  text: Type,
  code: Code,
  json: Braces,
  sheet: Table2,
  shell: Terminal,
  archive: Package2,
  file: File
}

export function FilesTreeIcon({
  name,
  className,
  style
}: {
  name: string
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  const Icon = ICONS[filesTreeIconKind(name)]
  return <Icon className={className} style={style} />
}
