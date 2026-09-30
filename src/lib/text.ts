export function capitalizeFirst(input: string) {
  const text = input.trim();
  return text ? text[0].toLocaleUpperCase("es-CL") + text.slice(1) : text;
}
