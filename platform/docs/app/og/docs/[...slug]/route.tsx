import { getPageImage, source } from '@/lib/source';
import { notFound } from 'next/navigation';
import { ImageResponse } from 'next/og';
import { generate as DefaultImage } from 'fumadocs-ui/og';

export const revalidate = false;

// The Pegasusbound mark, same single path as site/src/components/Logo.astro.
function Mark() {
  return (
    <svg width="52" height="52" viewBox="0 0 746 764" fill="none">
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

export async function GET(_req: Request, { params }: RouteContext<'/og/docs/[...slug]'>) {
  const { slug } = await params;
  const page = source.getPage(slug.slice(0, -1));
  if (!page) notFound();

  return new ImageResponse(
    <DefaultImage
      title={page.data.title}
      description={page.data.description}
      site="Pegasusbound Docs"
      icon={<Mark />}
      primaryColor="rgba(2, 132, 199, 0.45)"
      primaryTextColor="rgb(125, 211, 252)"
    />,
    {
      width: 1200,
      height: 630,
    },
  );
}

export function generateStaticParams() {
  return source.getPages().map((page) => ({
    lang: page.locale,
    slug: getPageImage(page).segments,
  }));
}
