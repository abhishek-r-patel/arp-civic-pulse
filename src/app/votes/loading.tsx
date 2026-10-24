import { ListSkeleton, PageHeader } from "@/components/ui/layout";

// Shown while a ballot or result loads; stable shapes, never placeholder numbers.
export default function Loading() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Loading" />
      <ListSkeleton label="Loading the vote" rows={4} />
    </div>
  );
}
