const config = require('./config');
const GitHubApi = require('github');

class Bot {

  constructor() {
    this.github = new GitHubApi({ version: '3.0.0' });

    if ((!config.github.user || !config.github.password) && !config.github.oauth2token) {
      throw Error('[fatal] No username/password or no Oauth2 token configured!');
    }

    if (config.github.oauth2token) {
      this.github.authenticate({
        type: 'oauth',
        token: config.github.oauth2token
      });
    } else {
      this.github.authenticate({
        type: 'basic',
        username: config.github.user,
        password: config.github.password
      });
    }
  }

  canReview (pr, callback) {
    this.getLabels(pr, labels => {
      const result = labels.filter(item => item.name === config.github.label.dontReview || item.name === config.github.label.checked);
      callback(result.length === 0);
    })
  }

  initialSetup(pr) {
    this.setReviwers(pr);
    this.selfAssignee(pr);
    this.updateLabels(pr);
    if (config.github.instructionsComment !== '') {
      this.postComment(pr.number, config.github.instructionsComment);
    }
  }

  checkReviews(pr, callback) {
    this.github.pullRequests.getReviews({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: pr.number,
    },
    this.genericAction(
      'getReview: Error while trying to get the reviews: ',
      resp => {
        const rejected = resp.filter(item => item.state === 'CHANGES_REQUESTED');
        const approved = resp.filter(item => item.state === 'APPROVED');

        if (rejected.length === 0 && approved >= config.github.reviewsNeeded) {
          this.addLabels(pr, config.github.label.ready, callback);
        }

        // TODO: Trigger Jira
      }
    ));
  }

  parseCommit(commitMessage) {
    const valid = config.github.firstCommitRegex.test(commitMessage);
    let issue = '';
    let project = '';
    let type = '';
    if (valid) {
      const splittedMessage = commitMessage.split(' ');
      issue = splittedMessage[0];
      project = issue.split('-')[0];
      type = splittedMessage[1].substring(0, splittedMessage[1].indexOf('('));
    }
    return {
      type,
      project,
      issue,
      valid,
    }
  }

  updateLabels(pr, callback) {
    this.getCommits(pr, resp => {
      const labels = [];
      resp.forEach(item => {
        const parsedCommit = this.parseCommit(item.commit.message);
        if (!parsedCommit.valid) {
          return;
        }

        if(labels.indexOf(parsedCommit.project) === -1) {
          labels.push(parsedCommit.project);
        }

        if(labels.indexOf(config.github.typeLabelMap[parsedCommit.type]) === -1) {
          labels.push(config.github.typeLabelMap[parsedCommit.type]);
        }
      });

      this.addLabels(pr, labels, callback);
    });
  }

  setReviwers(pr, callback) {
    const team = config.github.reviwers.prefix.filter(item => pr.title.indexOf(item) > -1)[0] || config.github.reviwers.prefix[0];
    const reviewers = config.github.reviwers.teams[team].split(' ');

    const myIndex = reviewers.indexOf(pr.user.login);
    if (myIndex > -1) {
      reviewers.splice(myIndex, 1);
    }

    this.github.pullRequests.createReviewRequest({
      number: pr.number,
      owner: config.github.repoOwner,
      repo: config.github.repo,
      reviewers,
    }, this.genericAction('createReviewRequest: Error while fetching creating reviewers', callback));
  }

  addLabels (pr, labels, callback) {
    this.github.issues.addLabels({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: pr.number,
      labels
    }, this.genericAction('addLabels: Error while trying add labels', callback));
  }

  selfAssignee(pr, callback) {
    this.github.issues.addAssigneesToIssue({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: pr.number,
      assignees: [pr.user.login]
    }, this.genericAction('addAssigneesToIssue: Error while assigning', callback));
  }

  postComment(number, comment, callback) {
    this.github.issues.createComment({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: number,
      body: comment
    }, this.genericAction('postComment: Error while trying to post instructions', callback));
  }

  getCommits(pr, callback) {
    this.github.pullRequests.getCommits({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: pr.number,
    }, this.genericAction('getCommits: Error while trying to get commits', callback));
  }

  getLabels(pr, callback) {
    this.github.issues.getIssueLabels({
      owner: config.github.repoOwner,
      repo: config.github.repo,
      number: pr.number
    }, this.genericAction('getIssueLabels: Error while trying get labels', callback));
  }

  getPullRequests(callback) {
    this.github.pullRequests.getAll({
        owner: config.github.repoOwner,
        repo: config.github.repo,
      }, this.genericAction('getPullRequests: Error while fetching PRs ', callback));
  }

  getPullRequest(number, callback) {
    this.github.pullRequests.get({
        owner: config.github.repoOwner,
        repo: config.github.repo,
        number
    }, this.genericAction('get: Error while fetching PR ', callback));
  }

  genericAction(message, callback) {
    return (error, result) => {
      if (error) {
        return console.log('[error]' + message, error);
      }

      if (callback) {
        callback(result.data);
      }
    }
  }
}

module.exports = new Bot();

