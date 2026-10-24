import { ListSkeleton, PageHeader } from "@/components/ui/layout";

// Shown while an administrator list or form loads; stable shapes, no fake values.
export default function Loading() {
  return (
    <div className="grid gap-8">
      <PageHeader title="Loading" />
      <ListSkeleton label="Loading the register" />
    </div>
  );
}
