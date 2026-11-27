// components/ui/icons.ts
//
// THE GLYPH VOCABULARY: every icon the web app draws, and the only module that imports
// the icon package. Call sites import glyphs from here and render them with
// `<Icon icon={…} />` (`components/ui/icon.tsx`), which picks the weight for the size.
//
// One line per glyph, from the per-icon `dist/ssr` entry rather than the package root:
//   - `ssr` components read no React context, so they render in Server Components as
//     well as client ones (the root export reads `IconContext` and needs a client);
//   - a per-file path keeps the dev compiler from walking the 1,512-icon barrel for
//     every module that draws one glyph.
//
// TO ADD A GLYPH: find it on phosphoricons.com and add its line here, alphabetically.
// Names keep Phosphor's own spelling plus `Icon`, so the docs and this file agree. A
// future change of icon set re-points these lines and leaves the call sites alone.

export { ArchiveIcon } from '@phosphor-icons/react/dist/ssr/Archive';
export { ArrowClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowClockwise';
export { ArrowCounterClockwiseIcon } from '@phosphor-icons/react/dist/ssr/ArrowCounterClockwise';
export { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowLeft';
export { ArrowSquareOutIcon } from '@phosphor-icons/react/dist/ssr/ArrowSquareOut';
export { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/ssr/ArrowUUpLeft';
export { ArrowUpRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowUpRight';
export { ArrowsDownUpIcon } from '@phosphor-icons/react/dist/ssr/ArrowsDownUp';
export { ArrowsLeftRightIcon } from '@phosphor-icons/react/dist/ssr/ArrowsLeftRight';
export { BankIcon } from '@phosphor-icons/react/dist/ssr/Bank';
export { BellIcon } from '@phosphor-icons/react/dist/ssr/Bell';
export { BellSlashIcon } from '@phosphor-icons/react/dist/ssr/BellSlash';
export { CalendarDotsIcon } from '@phosphor-icons/react/dist/ssr/CalendarDots';
export { CameraIcon } from '@phosphor-icons/react/dist/ssr/Camera';
export { CameraPlusIcon } from '@phosphor-icons/react/dist/ssr/CameraPlus';
export { CardsIcon } from '@phosphor-icons/react/dist/ssr/Cards';
export { CardsThreeIcon } from '@phosphor-icons/react/dist/ssr/CardsThree';
export { CaretDownIcon } from '@phosphor-icons/react/dist/ssr/CaretDown';
export { CaretLeftIcon } from '@phosphor-icons/react/dist/ssr/CaretLeft';
export { CaretRightIcon } from '@phosphor-icons/react/dist/ssr/CaretRight';
export { CaretUpIcon } from '@phosphor-icons/react/dist/ssr/CaretUp';
export { ChatCircleIcon } from '@phosphor-icons/react/dist/ssr/ChatCircle';
export { ChatCircleTextIcon } from '@phosphor-icons/react/dist/ssr/ChatCircleText';
export { ChatTeardropTextIcon } from '@phosphor-icons/react/dist/ssr/ChatTeardropText';
export { ChatsCircleIcon } from '@phosphor-icons/react/dist/ssr/ChatsCircle';
export { CheckCircleIcon } from '@phosphor-icons/react/dist/ssr/CheckCircle';
export { CheckIcon } from '@phosphor-icons/react/dist/ssr/Check';
export { CircleIcon } from '@phosphor-icons/react/dist/ssr/Circle';
export { CircleNotchIcon } from '@phosphor-icons/react/dist/ssr/CircleNotch';
export { ClockIcon } from '@phosphor-icons/react/dist/ssr/Clock';
export { CoinsIcon } from '@phosphor-icons/react/dist/ssr/Coins';
export { CopyIcon } from '@phosphor-icons/react/dist/ssr/Copy';
export { CreditCardIcon } from '@phosphor-icons/react/dist/ssr/CreditCard';
export { DesktopIcon } from '@phosphor-icons/react/dist/ssr/Desktop';
export { DeviceMobileIcon } from '@phosphor-icons/react/dist/ssr/DeviceMobile';
export { DiamondIcon } from '@phosphor-icons/react/dist/ssr/Diamond';
export { DotsThreeIcon } from '@phosphor-icons/react/dist/ssr/DotsThree';
export { DotsThreeVerticalIcon } from '@phosphor-icons/react/dist/ssr/DotsThreeVertical';
export { EnvelopeSimpleIcon } from '@phosphor-icons/react/dist/ssr/EnvelopeSimple';
export { EnvelopeSimpleOpenIcon } from '@phosphor-icons/react/dist/ssr/EnvelopeSimpleOpen';
export { ExclamationMarkIcon } from '@phosphor-icons/react/dist/ssr/ExclamationMark';
export { ExportIcon } from '@phosphor-icons/react/dist/ssr/Export';
export { EyeIcon } from '@phosphor-icons/react/dist/ssr/Eye';
export { EyeSlashIcon } from '@phosphor-icons/react/dist/ssr/EyeSlash';
export { FileTextIcon } from '@phosphor-icons/react/dist/ssr/FileText';
export { FlagIcon } from '@phosphor-icons/react/dist/ssr/Flag';
export { FlaskIcon } from '@phosphor-icons/react/dist/ssr/Flask';
export { GavelIcon } from '@phosphor-icons/react/dist/ssr/Gavel';
export { GearSixIcon } from '@phosphor-icons/react/dist/ssr/GearSix';
export { GlobeIcon } from '@phosphor-icons/react/dist/ssr/Globe';
export { GlobeSimpleIcon } from '@phosphor-icons/react/dist/ssr/GlobeSimple';
export { GpsFixIcon } from '@phosphor-icons/react/dist/ssr/GpsFix';
export { HandCoinsIcon } from '@phosphor-icons/react/dist/ssr/HandCoins';
export { HandshakeIcon } from '@phosphor-icons/react/dist/ssr/Handshake';
export { HeartIcon } from '@phosphor-icons/react/dist/ssr/Heart';
export { HourglassIcon } from '@phosphor-icons/react/dist/ssr/Hourglass';
export { ImageBrokenIcon } from '@phosphor-icons/react/dist/ssr/ImageBroken';
export { InfoIcon } from '@phosphor-icons/react/dist/ssr/Info';
export { KeyIcon } from '@phosphor-icons/react/dist/ssr/Key';
export { LinkIcon } from '@phosphor-icons/react/dist/ssr/Link';
export { ListIcon } from '@phosphor-icons/react/dist/ssr/List';
export { LockIcon } from '@phosphor-icons/react/dist/ssr/Lock';
export { LockKeyIcon } from '@phosphor-icons/react/dist/ssr/LockKey';
export { LockSimpleIcon } from '@phosphor-icons/react/dist/ssr/LockSimple';
export { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlass';
export { MagnifyingGlassPlusIcon } from '@phosphor-icons/react/dist/ssr/MagnifyingGlassPlus';
export { MapPinIcon } from '@phosphor-icons/react/dist/ssr/MapPin';
export { MinusCircleIcon } from '@phosphor-icons/react/dist/ssr/MinusCircle';
export { MoneyIcon } from '@phosphor-icons/react/dist/ssr/Money';
export { NoteIcon } from '@phosphor-icons/react/dist/ssr/Note';
export { NotePencilIcon } from '@phosphor-icons/react/dist/ssr/NotePencil';
export { PackageIcon } from '@phosphor-icons/react/dist/ssr/Package';
export { PaperPlaneRightIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneRight';
export { PaperPlaneTiltIcon } from '@phosphor-icons/react/dist/ssr/PaperPlaneTilt';
export { PencilSimpleIcon } from '@phosphor-icons/react/dist/ssr/PencilSimple';
export { PencilSimpleLineIcon } from '@phosphor-icons/react/dist/ssr/PencilSimpleLine';
export { PlusIcon } from '@phosphor-icons/react/dist/ssr/Plus';
export { PlusSquareIcon } from '@phosphor-icons/react/dist/ssr/PlusSquare';
export { QrCodeIcon } from '@phosphor-icons/react/dist/ssr/QrCode';
export { QuestionIcon } from '@phosphor-icons/react/dist/ssr/Question';
export { ScalesIcon } from '@phosphor-icons/react/dist/ssr/Scales';
export { SealCheckIcon } from '@phosphor-icons/react/dist/ssr/SealCheck';
export { SealPercentIcon } from '@phosphor-icons/react/dist/ssr/SealPercent';
export { ShieldCheckIcon } from '@phosphor-icons/react/dist/ssr/ShieldCheck';
export { ShieldIcon } from '@phosphor-icons/react/dist/ssr/Shield';
export { ShieldWarningIcon } from '@phosphor-icons/react/dist/ssr/ShieldWarning';
export { ShoppingBagIcon } from '@phosphor-icons/react/dist/ssr/ShoppingBag';
export { ShoppingCartIcon } from '@phosphor-icons/react/dist/ssr/ShoppingCart';
export { SignInIcon } from '@phosphor-icons/react/dist/ssr/SignIn';
export { SignOutIcon } from '@phosphor-icons/react/dist/ssr/SignOut';
export { SlidersHorizontalIcon } from '@phosphor-icons/react/dist/ssr/SlidersHorizontal';
export { SparkleIcon } from '@phosphor-icons/react/dist/ssr/Sparkle';
export { SpinnerGapIcon } from '@phosphor-icons/react/dist/ssr/SpinnerGap';
export { SquaresFourIcon } from '@phosphor-icons/react/dist/ssr/SquaresFour';
export { StarIcon } from '@phosphor-icons/react/dist/ssr/Star';
export { StorefrontIcon } from '@phosphor-icons/react/dist/ssr/Storefront';
export { SwapIcon } from '@phosphor-icons/react/dist/ssr/Swap';
export { TagIcon } from '@phosphor-icons/react/dist/ssr/Tag';
export { TimerIcon } from '@phosphor-icons/react/dist/ssr/Timer';
export { TrashIcon } from '@phosphor-icons/react/dist/ssr/Trash';
export { TrayIcon } from '@phosphor-icons/react/dist/ssr/Tray';
export { TruckIcon } from '@phosphor-icons/react/dist/ssr/Truck';
export { UploadSimpleIcon } from '@phosphor-icons/react/dist/ssr/UploadSimple';
export { UserCheckIcon } from '@phosphor-icons/react/dist/ssr/UserCheck';
export { UserIcon } from '@phosphor-icons/react/dist/ssr/User';
export { UserPlusIcon } from '@phosphor-icons/react/dist/ssr/UserPlus';
export { UsersIcon } from '@phosphor-icons/react/dist/ssr/Users';
export { UsersThreeIcon } from '@phosphor-icons/react/dist/ssr/UsersThree';
export { WalletIcon } from '@phosphor-icons/react/dist/ssr/Wallet';
export { WarningCircleIcon } from '@phosphor-icons/react/dist/ssr/WarningCircle';
export { WarningIcon } from '@phosphor-icons/react/dist/ssr/Warning';
export { WrenchIcon } from '@phosphor-icons/react/dist/ssr/Wrench';
export { XCircleIcon } from '@phosphor-icons/react/dist/ssr/XCircle';
export { XIcon } from '@phosphor-icons/react/dist/ssr/X';
