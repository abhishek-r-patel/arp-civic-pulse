// Administrator entry redirects to the unified Residents directory.
import { redirect } from "next/navigation";

export default function AdminIndexPage() {
  redirect("/admin/residents");
}
