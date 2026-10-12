import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

// The Pegasusbound mark (same path as site/'s Logo.astro), monochrome via currentColor.
function Mark() {
  return (
    <svg width="20" height="20" viewBox="0 0 746 764" fill="none" aria-hidden="true">
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

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      url: '/guides/',
      title: (
        <div className="flex items-center gap-2">
          <Mark />
          <span className="font-extrabold tracking-tight text-[15px]">Pegasusbound</span>
          <span className="text-[15px] font-normal text-fd-muted-foreground">Docs</span>
        </div>
      ),
    },
    githubUrl: 'https://github.com/pegasusbound/pegasusbound',
    themeSwitch: { mode: 'light-dark' },
    links: [
      {
        text: 'pegasusbound.com',
        url: 'https://pegasusbound.com',
      },
      {
        type: 'custom',
        on: 'nav',
        secondary: true,
        children: (
          <a
            href="https://app.pegasusbound.com"
            className="inline-flex h-8 items-center whitespace-nowrap rounded-full bg-fd-foreground px-3.5 text-[13px] font-medium text-fd-background transition-opacity hover:opacity-85"
          >
            Open dashboard
          </a>
        ),
      },
    ],
  };
}
