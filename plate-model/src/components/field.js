export function createField({
  name,
  label,
  labelTex,
  value,
  type = "number",
  wide = false,
  options = [],
  renderMath,
}) {
  const wrapper = document.createElement("div");
  wrapper.className = wide ? "field field-wide" : "field";

  let title = null;
  if (labelTex || label) {
    title = document.createElement("label");
    title.htmlFor = `field-${name}`;
    title.className = "field-label";

    if (labelTex && renderMath) {
      const mathSlot = document.createElement("span");
      mathSlot.className = "math-label";
      title.append(mathSlot);
      renderMath(labelTex, mathSlot);
    } else {
      title.textContent = label ?? "";
    }
  }

  let input;
  if (type === "textarea") {
    input = document.createElement("textarea");
    input.rows = 3;
    input.value = value;
  } else if (type === "select") {
    input = document.createElement("select");
    for (const option of options) {
      const optionNode = document.createElement("option");
      optionNode.value = option.value;
      optionNode.textContent = option.label;
      optionNode.selected = option.value === value;
      input.append(optionNode);
    }
  } else {
    input = document.createElement("input");
    input.type = type;
    input.step = type === "number" ? "any" : undefined;
    input.value = String(value);
  }

  input.id = `field-${name}`;
  input.name = name;

  if (title) {
    wrapper.append(title);
  }
  wrapper.append(input);
  return { wrapper, input };
}
