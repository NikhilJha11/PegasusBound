// The Pegasusbound geometric mark. Single-path, inherits color via currentColor so
// it works on light or dark surfaces. Mirrors the wordmark used on the
// marketing site and dashboard so the admin app shares one brand.

export function Logo({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 746 764"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-hidden="true"
        >
            <path d="M140 548C300 462 468 300 616 120L596 292C478 418 326 516 140 548Z"
                fill="currentColor"
             /><path d="M140 640C326 604 498 504 640 352L612 476C490 580 330 638 140 640Z"
                fill="currentColor"
             /><path d="M140 724C318 716 470 656 594 560L566 650C452 722 302 744 140 724Z"
                fill="currentColor"
             />
        </svg>
    );
}
