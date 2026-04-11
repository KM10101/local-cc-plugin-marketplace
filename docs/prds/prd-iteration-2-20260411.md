### Marketplaces页面

- 部分插件，源的类型为git-subdir，目前还不支持，需要能够支持，例如

  - ```
        {
          "name": "ai-firstify",
          "description": "AI-first project auditor and re-engineer based on the 9 design principles and 7 design patterns from the TechWolf AI-First Bootcamp",
          "source": {
            "source": "git-subdir",
            "url": "techwolf-ai/ai-first-toolkit",
            "path": "plugins/ai-firstify",
            "ref": "main",
            "sha": "7f18e11d694b9ae62ea3009fbbc175f08ae913df"
          },
          "homepage": "https://ai-first.techwolf.ai"
        }
    ```

    

- 部分插件的描述信息没有解析出来，例如

  - ```
      "plugins": [
        {
          "name": "document-skills",
          "description": "Collection of document processing suite including Excel, Word, PowerPoint, and PDF capabilities",
          "source": "./",
          "strict": false,
          "skills": [
            "./skills/xlsx",
            "./skills/docx",
            "./skills/pptx",
            "./skills/pdf"
          ]
        }
      ]
    ```

- 有些仓库的插件没有提供marketplace.json文件，而是在.claude-plugin目录下放了plugin.json文件（例如https://github.com/nvsecurity/nightvision-skills/blob/main/.claude-plugin/plugin.json）。针对这类的仓库，也需要能正常执行解析

### Tasks页面

- 克隆某个marketplace时，clone其他github仓库的插件时，希望能以子任务的形式clone。而不是整个marketplace目录下的插件只有一个clone任务

- clone时，除去进度，能正常显示clone的这个仓库的进度，和正常在命令行执行git clone操作时的输出一致或者类似，有Receiving objects、Resolving deltas等数据，而不只是一个单纯的进度条。

  - ```
    qli@DESKTOP-K02G1K4:/tmp$ git clone https://github.com/anthropics/skills.git
    Cloning into 'skills'...
    remote: Enumerating objects: 660, done.
    remote: Counting objects: 100% (13/13), done.
    remote: Compressing objects: 100% (13/13), done.
    remote: Total 660 (delta 2), reused 0 (delta 0), pack-reused 647 (from 2)
    Receiving objects: 100% (660/660), 3.45 MiB | 1.51 MiB/s, done.
    Resolving deltas: 100% (160/160), done.
    qli@DESKTOP-K02G1K4:/tmp$
    ```

    


### 其他

- 针对上述的解析逻辑修改，在开始设计方案前，最好能搜索一下相关资料，了解一下claude code的marketplace的编写规范，确保能够解析各种不同类型的仓库

### 说明

- 功能改动涉及到数据库结构的变化时，可以不考虑数据迁移问题，可以直接把已有的数据删除
