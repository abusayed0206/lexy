/**
 * Built-in LaTeX commands and environments for suggestions (spec 007 R2). Templates use
 * `@codemirror/autocomplete` snippet syntax: `${}` is a placeholder, `${name}` a named one.
 */

export type BuiltinCommand = { label: string; template: string; detail: string };

/** `name|template|detail`; a template without `\` is used as `\name` + template. */
const COMMANDS = `
part|{\${}}|Part heading
chapter|{\${}}|Chapter heading
section|{\${}}|Heading 1
subsection|{\${}}|Heading 2
subsubsection|{\${}}|Heading 3
paragraph|{\${}}|Run-in heading
subparagraph|{\${}}|Run-in heading
section*|{\${}}|Unnumbered heading
subsection*|{\${}}|Unnumbered heading
chapter*|{\${}}|Unnumbered chapter
textbf|{\${}}|Bold
textit|{\${}}|Italic
emph|{\${}}|Emphasis
underline|{\${}}|Underline
texttt|{\${}}|Monospace
textsc|{\${}}|Small caps
textsf|{\${}}|Sans serif
textrm|{\${}}|Roman
textsuperscript|{\${}}|Superscript
textsubscript|{\${}}|Subscript
textcolor|{\${color}}{\${}}|Colored text
footnote|{\${}}|Footnote
label|{\${}}|Label for \\ref
ref|{\${}}|Reference
eqref|{\${}}|Equation reference
pageref|{\${}}|Page reference
autoref|{\${}}|Reference with name (hyperref)
cref|{\${}}|Clever reference (cleveref)
cite|{\${}}|Citation
citep|{\${}}|Parenthetical citation (natbib)
citet|{\${}}|Textual citation (natbib)
parencite|{\${}}|Parenthetical citation (biblatex)
textcite|{\${}}|Textual citation (biblatex)
autocite|{\${}}|Citation (biblatex)
nocite|{\${}}|List without citing
url|{\${}}|URL
href|{\${url}}{\${text}}|Link
includegraphics|[width=\${0.8}\\linewidth]{\${}}|Image
caption|{\${}}|Caption
centering||Center the float contents
input|{\${}}|Insert a file
include|{\${}}|Include a chapter file
usepackage|{\${}}|Load a package
documentclass|{\${article}}|Document class
newcommand|{\\\${name}}[\${1}]{\${}}|Define a command
renewcommand|{\\\${name}}{\${}}|Redefine a command
DeclareMathOperator|{\\\${name}}{\${}}|Math operator
title|{\${}}|Document title
author|{\${}}|Document author
date|{\${\\today}}|Document date
maketitle||Print the title
tableofcontents||Table of contents
listoffigures||List of figures
listoftables||List of tables
appendix||Start appendices
bibliography|{\${references}}|Bibliography file
bibliographystyle|{\${plain}}|Bibliography style
printbibliography||Print bibliography (biblatex)
addbibresource|{\${references.bib}}|Bibliography file (biblatex)
item||List item
newpage||New page
clearpage||Flush floats and start a page
pagebreak||Page break
linebreak||Line break
noindent||No paragraph indent
vspace|{\${1em}}|Vertical space
hspace|{\${1em}}|Horizontal space
smallskip||Small vertical space
medskip||Medium vertical space
bigskip||Big vertical space
hfill||Fill horizontal space
vfill||Fill vertical space
today||Today's date
LaTeX||LaTeX logo
TeX||TeX logo
ldots||Ellipsis …
dots||Ellipsis
quad||Space (1em)
qquad||Space (2em)
tiny||Font size
scriptsize||Font size
footnotesize||Font size
small||Font size
normalsize||Font size
large||Font size
Large||Font size
LARGE||Font size
huge||Font size
Huge||Font size
hline||Table rule
cline|{\${2-3}}|Partial table rule
toprule||Table rule (booktabs)
midrule||Table rule (booktabs)
bottomrule||Table rule (booktabs)
multicolumn|{\${2}}{\${c}}{\${}}|Cell over columns
multirow|{\${2}}{*}{\${}}|Cell over rows (multirow)
frac|{\${num}}{\${den}}|Fraction
dfrac|{\${num}}{\${den}}|Display fraction
sqrt|{\${}}|Square root
sum|_{\${i=1}}^{\${n}}|Sum
prod|_{\${i=1}}^{\${n}}|Product
int|_{\${a}}^{\${b}}|Integral
oint||Contour integral
lim|_{\${x \\to \\infty}}|Limit
infty||∞
partial||∂
nabla||∇
cdot||·
times||×
div||÷
pm||±
mp||∓
leq||≤
geq||≥
neq||≠
approx||≈
equiv||≡
sim||∼
propto||∝
in||∈
notin||∉
subset||⊂
subseteq||⊆
cup||∪
cap||∩
emptyset||∅
forall||∀
exists||∃
neg||¬
land||∧
lor||∨
to||→
rightarrow||→
leftarrow||←
Rightarrow||⇒
Leftarrow||⇐
leftrightarrow||↔
Leftrightarrow||⇔
mapsto||↦
alpha||α
beta||β
gamma||γ
delta||δ
epsilon||ε
varepsilon||ε
zeta||ζ
eta||η
theta||θ
iota||ι
kappa||κ
lambda||λ
mu||μ
nu||ν
xi||ξ
pi||π
rho||ρ
sigma||σ
tau||τ
upsilon||υ
phi||φ
varphi||φ
chi||χ
psi||ψ
omega||ω
Gamma||Γ
Delta||Δ
Theta||Θ
Lambda||Λ
Xi||Ξ
Pi||Π
Sigma||Σ
Phi||Φ
Psi||Ψ
Omega||Ω
mathbb|{\${R}}|Blackboard bold
mathcal|{\${}}|Calligraphic
mathbf|{\${}}|Bold math
mathrm|{\${}}|Upright math
mathit|{\${}}|Italic math
text|{\${}}|Text in math
operatorname|{\${}}|Operator name
hat|{\${}}|Hat accent
bar|{\${}}|Bar accent
vec|{\${}}|Vector arrow
tilde|{\${}}|Tilde accent
dot|{\${}}|Dot accent
overline|{\${}}|Overline
underbrace|{\${}}_{\${}}|Underbrace
overbrace|{\${}}^{\${}}|Overbrace
left|(|Sized left delimiter
right|)|Sized right delimiter
sin||Sine
cos||Cosine
tan||Tangent
log||Logarithm
ln||Natural logarithm
exp||Exponential
max||Maximum
min||Minimum
binom|{\${n}}{\${k}}|Binomial
displaystyle||Display style math
setlength|{\\\${parindent}}{\${0pt}}|Set a length
textwidth||Text width
linewidth||Line width
`;

/** Environments for `\begin{…}` suggestions: `name|args|detail`. */
const ENVIRONMENTS = `
document||Document body
abstract||Abstract
itemize||Bullet list
enumerate||Numbered list
description||Description list
figure|[\${htbp}]|Float with an image
figure*|[\${htbp}]|Full-width figure
table|[\${htbp}]|Float with a table
tabular|{\${ll}}|Table
tabularx|{\\linewidth}{\${XX}}|Table with stretching columns
longtable|{\${ll}}|Table over pages
center||Centered block
flushleft||Left-aligned block
flushright||Right-aligned block
quote||Short quotation
quotation||Long quotation
verbatim||Text as typed
lstlisting||Code listing (listings)
minted|{\${python}}|Code listing (minted)
equation||Numbered equation
equation*||Unnumbered equation
align||Aligned equations
align*||Aligned equations, unnumbered
gather||Centered equations
multline||Equation over lines
cases||Cases (in math)
matrix||Matrix
pmatrix||Matrix in ( )
bmatrix||Matrix in [ ]
array|{\${cc}}|Array (in math)
theorem||Theorem
lemma||Lemma
proof||Proof
definition||Definition
example||Example
remark||Remark
minipage|{\${0.5\\linewidth}}|Box with its own width
frame|{\${Title}}|Beamer slide
columns||Beamer columns
column|{\${0.5\\textwidth}}|Beamer column
block|{\${Title}}|Beamer block
thebibliography|{\${99}}|Manual bibliography
appendices||Appendices
subfigure|{\${0.45\\linewidth}}|Sub-figure (subcaption)
`;

function parse(table: string): [string, string, string][] {
  return table
    .trim()
    .split("\n")
    .map((line) => line.split("|") as [string, string, string]);
}

export const BUILTIN_COMMANDS: BuiltinCommand[] = parse(COMMANDS).map(([name, template, detail]) => ({
  label: `\\${name}`,
  template: `\\${name}${template}`,
  detail,
}));

export type BuiltinEnvironment = { name: string; args: string; detail: string };
export const BUILTIN_ENVIRONMENTS: BuiltinEnvironment[] = parse(ENVIRONMENTS).map(([name, args, detail]) => ({ name, args, detail }));
