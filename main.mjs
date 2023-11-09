import axios from 'axios';

const DINGTALK_API =
  // 这个是测试用 API，不要乱用
  // "https://oapi.dingtalk.com/robot/send?access_token=61952a7ea190cf677a9ef23051fcb3f75fafba276f415c36fd3cda55b9dd0f52";
  `https://oapi.dingtalk.com/robot/send?access_token=${process.env.DINGTALK_ACCESS_TOKEN}`;

// 这个是 read-only TOKEN，expired at 2024.2.21，拿去也没用，建议看到的佬自己去申请一个用
axios.defaults.headers.common["Authorization"] = `Bearer ${process.env.GITHUB_AUTH_TOKEN}`;

const contributorsEmployeeMapping = {
  wssgcg1213: "wssgcg1213",
  chenjun1011: "enswc1v",
  luhc228: "a3v_os7yv8tyx",
  ChrisCindy: "y576973",
  answershuto: "71r-sp8sbu5w5",
  ClarkXia: "nfw_re9zo9j3h",
  linbudu599: "1wa_62eg934kpd",
  FuzzyFade: "icecee",
};

const atDingtalkIds = [];
function convertToDingtalkId(githubName) {
  const hitDingtalkId = contributorsEmployeeMapping[githubName];
  if (hitDingtalkId) {
    atDingtalkIds.push(hitDingtalkId);
    return hitDingtalkId;
  } else {
    return githubName;
  }
}

let shouldNotify = false;

function queryIssues(repos) {
  // 清空 atDingtalkIds
  atDingtalkIds.length = 0;
  return Promise.all(
    repos.map((repo) => {
      const api = `https://api.github.com/repos/${repo}/issues?labels=need%20review&state=open`;
      return axios.get(api);
    })
  ).then((reses) => {
    const ret = [];
    for (let res of reses) {
      if (Array.isArray(res.data) && res.data.length > 0) {
        ret.push(...res.data);
      }
    }
    return ret;
  });
}

function main() {
  queryIssues(["alibaba/ice", "ice-lab/icepkg", "ice-lab/icepack"])
    .then((issues) => {
      if (Array.isArray(issues) && issues.length > 0) {
        const tasks = [];
        for (let issue of issues) {
          if (issue.pull_request) {
            tasks.push(
              axios.get(issue.pull_request.url).then((res) => res.data)
            );
          }
        }
        return Promise.all(tasks);
      }
      return [];
    })
    .then(async (prs) => {
      const messages = [];
      for (let pr of prs) {
        let message = "";
        shouldNotify = true;

        message += `・${pr.html_url} 「${pr.title}」 `;

        // check mergeable_state
        if (pr.mergeable_state === "dirty") {
          message += `❌ 存在冲突，请作者 @${convertToDingtalkId(
            pr.user.login
          )} 解决\n`;
          messages.push(message);
          continue;
        }
        if (pr.mergeable_state === "unstable") {
          message += `❌ 存在 CI 不通过，请作者 @${convertToDingtalkId(
            pr.user.login
          )} 检查\n`;
          messages.push(message);
          continue;
        }

        const requestedReviewers = [...pr.requested_reviewers];
        const approvedReviewers = [];
        const requestChangesReviewers = [];
        const totalReviewers = [...requestedReviewers];

        const reviews = (await axios.get(pr.url + "/reviews?per_page=100")).data;
        for (let review of reviews) {
          if (review.state === "APPROVED") {
            approvedReviewers.push(review.user);
          } else if (review.state === 'CHANGES_REQUESTED') {
            requestChangesReviewers.push(review.user);
          }
          // 需要去重
          if (!totalReviewers.find((user) => user.id === review.user.id)) {
            totalReviewers.push(review.user);
          }
        }

        // 所有 Review 完成
        if (
          totalReviewers.length > 0 &&
          (approvedReviewers.length >= totalReviewers.length ||
            approvedReviewers.length >= 2)
        ) {
          message += `已经 Review 完成，✅ 请作者 @${convertToDingtalkId(
            pr.user.login
          )} 尽快合并`;
          messages.push(message);
          continue;
        } else {
          message += "待 Review，";
        }


        // 已经 Approved 的人
        if (approvedReviewers.length > 0) {
          message += `已有 ${approvedReviewers.length} 人 Approved；`;
        }

        // Request Changes 的人
        if (requestChangesReviewers.length > 0) {
          message += "❌ 有人 Request Changes；";
          message += `请作者 @${convertToDingtalkId(
            pr.user.login
          )} 评估是否需要修改\n`;
          messages.push(message);
          continue;
        }

        // 需要 Review 的人
        if (requestedReviewers.length > 0) {
          message += "请 ";
          for (let user of requestedReviewers) {
            message += `@${convertToDingtalkId(user.login)} `;
          }
          message += "尽快 Review；";
        }

        // 没有设置 Review 人
        if (totalReviewers.length === 0) {
          message += `请作者 @${convertToDingtalkId(
            pr.user.login
          )} 尽快设置 Reviewer`;
        }

        message += "\n";
        messages.push(message);
      }
      return messages.join("\n");
    })
    .then((formattedMessage) => {
      if (shouldNotify) {
        return axios.post(DINGTALK_API, {
          msgtype: "text",
          text: {
            content: formattedMessage,
          },
          at: {
            atDingtalkIds,
            isAtAll: false,
          },
        });
      }
    });
}

main();
