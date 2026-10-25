# 工作里的小句子

这是一份原创功能演示讲义。它用开发场景练习英语表达，不代表任何官方考试考纲。

## 条件与结果

描述未来有可能发生的情况，可以用 If + 一般现在时，主句用 will + 动词原形。例如：If the request fails, we will retry it. 请求失败是条件，重试是结果。不要因为说的是未来，就把 if 从句写成 If the request will fail。主句在前时通常不用逗号：We will retry the request if it fails。

When 常用于预期会发生的时间节点；if 强调是否发生尚不确定。If the build fails, we will inspect the logs. 表示构建可能成功，也可能失败；When the build finishes, we will inspect the report. 则把完成当作预期事件。

## 原因与结果

Because 后接一个完整的原因从句：We retried the request because the connection timed out. 也可以先交代原因：Because the connection timed out, we retried the request. Therefore 用来引出结果，适合另起一句：The connection timed out. Therefore, we retried the request.

在这套练习中，不把 because 和 so 同时用来连接同一组因果分句。原因可以帮助解释一个决定，但不能把时间先后直接当作因果证据。The latency fell after deployment. 只说明先后；The latency fell because we removed a repeated query. 才明确提出因果解释。

## 让步与转折

Although 后接完整从句，表示让步：Although the cache is fast, it can return stale data. 两部分表达“尽管……，仍然……”。在这套练习中，不再用 but 重复连接同一个 although 从句。However 是转折副词，可以另起一句：The cache is fast. However, it can return stale data.

Yet 和 still 常帮助保留“与预期相反”的重点。例如：The test passed, yet the bug remained. 表达测试通过仍未消除问题。选词前先判断两部分是在补充、解释原因，还是形成反差。

## 说明与建议

Must 表示本段规则中的必要要求；should 表示建议：You must set the database URL before starting the app. You should keep a backup before upgrading. 祈使句直接使用动词原形：Save the file. Then restart the server. 否定祈使句用 Do not：Do not commit secrets.

写操作说明时，先给条件和顺序，再说期望结果：First, save the configuration. Then restart the server. If the health check fails, inspect the logs. 省略顺序或把建议写成强制要求，会使读者误解。语言练习里的 must/should 表达强度，应服从题目给出的场景规则。
