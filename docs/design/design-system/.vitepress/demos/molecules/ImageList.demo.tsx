import { ImageList, ImageListItem, ImageListItemBar } from "@/design-system";

const swatch = (c: string) =>
  `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><rect width='160' height='160' fill='${encodeURIComponent(
    c
  )}'/></svg>`;

const tiles = [
  { c: "#0056a7", title: "Ocean" },
  { c: "#2f8f4e", title: "Forest" },
  { c: "#c0392b", title: "Ember" },
  { c: "#8e44ad", title: "Violet" },
];

export default function ImageListDemo() {
  return (
    <ImageList sx={{ width: 340, height: 180 }} cols={2} rowHeight={90}>
      {tiles.map((t) => (
        <ImageListItem key={t.title}>
          <img src={swatch(t.c)} alt={t.title} loading="lazy" />
          <ImageListItemBar title={t.title} />
        </ImageListItem>
      ))}
    </ImageList>
  );
}
