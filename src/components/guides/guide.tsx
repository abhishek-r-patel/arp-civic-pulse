// Server-rendered guide navigation, accessible sections and lazy synthetic illustrations.
import Image from "next/image";
import type { ReactNode } from "react";
import dimensions from "../../../public/guides/dimensions.json";
import { PageHeader } from "@/components/ui/layout";
import {
  GUIDE_IMAGES,
  guideImagePath,
  type GuideImage,
} from "@/shared/guides/screenshots";

export interface GuideSection {
  id: string;
  title: string;
  content: ReactNode;
}

export function Guide({
  title,
  description,
  sections,
  technical = false,
}: Readonly<{
  title: string;
  description: string;
  sections: readonly GuideSection[];
  technical?: boolean;
}>) {
  return (
    <article className="mx-auto grid max-w-7xl gap-8">
      <PageHeader title={title} description={description} />
      {!technical ? (
        <nav aria-label="Guide personas" className="flex flex-wrap gap-3">
          <a
            className="inline-flex touch-target items-center text-accent underline"
            href="/user-guide"
          >
            Choose your guide
          </a>
          <a
            className="inline-flex touch-target items-center text-accent underline"
            href="/user-guide/resident"
          >
            Resident
          </a>
          <a
            className="inline-flex touch-target items-center text-accent underline"
            href="/user-guide/rwa-admin"
          >
            RWA Admin
          </a>
        </nav>
      ) : null}
      <div className="grid items-start gap-8 lg:grid-cols-[17rem_minmax(0,1fr)]">
        <nav
          id="contents"
          aria-label="Contents"
          className="scroll-mt-6 rounded-control border border-border bg-surface p-4 lg:sticky lg:top-6 lg:max-h-[85dvh] lg:overflow-y-auto"
        >
          <h2 className="mb-3 text-section font-semibold text-primary">
            On this page
          </h2>
          <ul role="list" className="grid gap-1 text-caption">
            {sections.map((section) => (
              <li key={section.id}>
                <a
                  className="inline-flex touch-target items-center py-2 text-accent underline"
                  href={`#${section.id}`}
                >
                  {section.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 gap-12 text-body text-muted">
          {sections.map((section) => (
            <section
              id={section.id}
              key={section.id}
              aria-labelledby={`${section.id}-title`}
              className="grid min-w-0 scroll-mt-6 gap-4"
            >
              <h2
                id={`${section.id}-title`}
                className="text-section font-semibold text-primary md:text-section-lg"
              >
                {section.title}
              </h2>
              {section.content}
              <a
                className="inline-flex touch-target w-fit items-center text-caption text-accent underline"
                href="#contents"
              >
                Back to contents
              </a>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}

export function Steps({ children }: Readonly<{ children: ReactNode }>) {
  return <ol className="grid list-decimal gap-3 pl-6">{children}</ol>;
}

export function Note({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <aside className="rounded-control border border-border bg-surface p-4 text-body">
      {children}
    </aside>
  );
}

export function Screenshot({ image }: Readonly<{ image: GuideImage }>) {
  const path = guideImagePath(image);
  const [, , caption] = GUIDE_IMAGES[image];
  const size = new Map<string, { width: number; height: number }>(
    Object.entries(dimensions),
  ).get(path);
  if (!size) throw new Error(`Missing guide screenshot dimensions: ${path}`);
  return (
    <figure className="grid min-w-0 gap-2 rounded-control border border-border bg-surface p-3">
      <a
        href={path}
        target="_blank"
        rel="noreferrer"
        className="block rounded-control"
        aria-label={`Open full-size screenshot: ${caption} (new tab)`}
      >
        <Image
          src={path}
          width={size.width}
          height={size.height}
          alt={caption}
          unoptimized
          loading="lazy"
          className="mx-auto h-auto max-h-[48rem] w-auto max-w-full object-contain"
        />
      </a>
      <figcaption className="text-caption text-muted">
        {caption} Open the image for full size.
      </figcaption>
    </figure>
  );
}

export function FileTable({
  rows,
}: Readonly<{ rows: readonly (readonly [string, string])[] }>) {
  return (
    <div
      role="region"
      aria-label="Source file map"
      tabIndex={0}
      className="min-w-0 overflow-x-auto rounded-control border border-border"
    >
      <table className="w-full text-left text-caption">
        <caption className="sr-only">
          Source paths relative to the repository root and their
          responsibilities
        </caption>
        <thead className="bg-surface text-primary">
          <tr>
            <th scope="col" className="p-3">
              File or folder
            </th>
            <th scope="col" className="p-3">
              Purpose / next step
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([path, purpose]) => (
            <tr key={path} className="border-t border-border">
              <th scope="row" className="p-3 align-top font-normal">
                <code className="break-all">{path}</code>
              </th>
              <td className="min-w-56 p-3 align-top">{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
