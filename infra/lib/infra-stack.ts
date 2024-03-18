import {
  Stack,
  StackProps,
  SecretValue,
  RemovalPolicy,
  aws_codepipeline as codepipeline,
  aws_codepipeline_actions as codepipelineActions,
  aws_codebuild as codebuild,
  aws_s3 as s3,
  aws_cloudfront as cloudfront,
  aws_cloudfront_origins as cfOrigins,
  aws_iam as iam
} from 'aws-cdk-lib';
import { Construct } from 'constructs';

export class InfraStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const sourceOutput = new codepipeline.Artifact()
    const buildOutput = new codepipeline.Artifact()

    const sourceAction = new codepipelineActions.GitHubSourceAction({
      actionName: 'GithubSource',
      owner: 'mactunechy',
      repo: 'cdk-s3-static-site-hosting',
      oauthToken: SecretValue.secretsManager('github_token2'),
      output: sourceOutput,
      branch: 'master'
    })

    const buildAction = new codepipelineActions.CodeBuildAction({
      actionName: 'Build',
      project: new codebuild.PipelineProject(this, 'ViteSiteBuildProject', {
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              'runtime-versions': {
                nodejs: 'latest' //TODO: use a specific version
              },
              commands: [
                'cd app',
                'npm install pnpm -g',
                'pnpm install'
              ],
            },
            build: {
              commands: ['pnpm run build'],
            },
          },
          artifacts: {
            files: ['**/*'],
            'base-directory': 'app/dist',
          },

        }),
        environment: {
          buildImage: codebuild.LinuxBuildImage.AMAZON_LINUX_2_5,
        }
      }),
      input: sourceOutput,
      outputs: [buildOutput],
    })

    const bucket = new s3.Bucket(this, 'ViteStiteBucket', {
      websiteIndexDocument: 'index.html',
      removalPolicy: RemovalPolicy.DESTROY,
    })

    // Add a policy statement to allow public read access
    bucket.addToResourcePolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [bucket.arnForObjects('*')],
      principals: [new iam.AnyPrincipal()],
    }));

    const originAccess = new cloudfront.OriginAccessIdentity(this, 'OriginAccessControl', {
      comment: 'Vite site'
    });

    new cloudfront.Distribution(this, 'ViteSiteDistribution', {
      defaultBehavior: {
        origin: new cfOrigins.S3Origin(bucket, { originAccessIdentity: originAccess }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS
      },
      errorResponses: [
        {
          httpStatus: 403,
          responsePagePath: '/error.html',
          responseHttpStatus: 200
        }
      ],
    })

    const deployAction = new codepipelineActions.S3DeployAction({
      actionName: 'S3Deploy',
      input: buildOutput,
      bucket
    })

    const pipeline = new codepipeline.Pipeline(this, 'ViteSitePipeline', {
      pipelineName: 'ViteSitePipeline',
      // let's save CMK since we're not doing any cross-account deployments
      crossAccountKeys: false,
    });

    pipeline.addStage({
      stageName: 'Source',
      actions: [sourceAction],
    })

    pipeline.addStage({
      stageName: 'Build',
      actions: [buildAction]
    })

    pipeline.addStage({
      stageName: 'Deploy',
      actions: [deployAction]
    })
  }
}
