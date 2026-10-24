import { redirect } from "next/navigation";

// The register's landing page is the household list.
export default function AdminIndexPage() {
  redirect("/admin/households");
}
