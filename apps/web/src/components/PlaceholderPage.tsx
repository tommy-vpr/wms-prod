import { useLayout } from "../layouts";

export function PlaceholderPage({
  title,
  icon: Icon,
}: {
  title: string;
  icon: any;
}) {
  const { compactMode } = useLayout();

  return (
    <div className={compactMode ? "p-4" : "p-6"}>
      <h1 className="text-2xl font-bold mb-6 flex items-center gap-3">
        <Icon className="w-8 h-8 text-blue-500" />
        {title}
      </h1>

      <div className="bg-white border rounded-lg p-8 text-center text-gray-500">
        <p>This page is under construction.</p>
        <p className="text-sm mt-2">
          Replace this placeholder with actual content.
        </p>
      </div>
    </div>
  );
}
