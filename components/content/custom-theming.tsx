import {  codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin,  frontmatterPlugin, headingsPlugin, imagePlugin, KitchenSinkToolbar, linkDialogPlugin, linkPlugin, listsPlugin, markdownShortcutPlugin, MDXEditor, quotePlugin,  tablePlugin, thematicBreakPlugin, toolbarPlugin } from "@mdxeditor/editor";

export function CustomTheming() {
  return (
    <MDXEditor 
          className="dark-theme dark-editor"
          plugins={[
              toolbarPlugin({ toolbarContents: () => <KitchenSinkToolbar /> }),
              listsPlugin(),
              quotePlugin(),
              headingsPlugin(),
              linkPlugin(),
              linkDialogPlugin(),
              imagePlugin(),
              tablePlugin(),
              thematicBreakPlugin(),
              frontmatterPlugin(),
              codeBlockPlugin({ defaultCodeBlockLanguage: 'txt' }),
              codeMirrorPlugin({ codeBlockLanguages: { js: 'JavaScript', css: 'CSS', txt: 'text', tsx: 'TypeScript' } }),
              diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: 'boo' }),
              markdownShortcutPlugin()
          ]} markdown={""}    />
  )
}