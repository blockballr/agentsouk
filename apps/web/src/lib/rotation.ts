// The shelf no longer rotates. Every reader and every cache sees the same
// order, which is also what makes one warmed URL serve the whole site.
export function visitSeed(): string {
  return 'shelf'
}
