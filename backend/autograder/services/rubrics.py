from copy import deepcopy

from django.db.models import Max

from ..models import (
    RubricTemplateScope,
    Rubric,
    RubricCriterion,
    RubricCriterionLevel,
    RubricTemplate,
    RubricTemplateCriterion,
    RubricTemplateCriterionLevel,
    RubricTemplateVersion,
    RubricVersion,
)


def _banded_levels(max_points, *, exceeds, meets, developing, missing):
    max_value = float(max_points)
    return [
        {
            'label': 'Exceeds expectations',
            'min_points': round(max_value * 0.9, 2),
            'max_points': round(max_value, 2),
            'description': exceeds,
            'order_index': 0,
        },
        {
            'label': 'Meets expectations',
            'min_points': round(max_value * 0.75, 2),
            'max_points': round(max_value * 0.89, 2),
            'description': meets,
            'order_index': 1,
        },
        {
            'label': 'Developing',
            'min_points': round(max_value * 0.4, 2),
            'max_points': round(max_value * 0.74, 2),
            'description': developing,
            'order_index': 2,
        },
        {
            'label': 'Missing or incorrect',
            'min_points': 0,
            'max_points': round(max_value * 0.39, 2),
            'description': missing,
            'order_index': 3,
        },
    ]


def _criterion(name, max_points, *, exceeds, meets, developing, missing, weight=None):
    return {
        'name': name,
        'max_points': max_points,
        'weight': weight,
        'levels': _banded_levels(
            max_points,
            exceeds=exceeds,
            meets=meets,
            developing=developing,
            missing=missing,
        ),
    }


COURSE_STARTER_RUBRIC_TEMPLATES = [
    {
        'slug': 'programming-assignment-sample',
        'name': 'Programming Assignment Sample',
        'description': 'Ready-to-use sample rubric for core programming assignments with scoring guidance for correctness, requirements, design, and testing.',
        'is_weighted': False,
        'criteria': [
            _criterion(
                'Program correctness',
                45,
                exceeds='The solution runs correctly, handles expected edge cases, and produces the required output consistently.',
                meets='The main workflow is correct with only small issues that do not meaningfully change the result.',
                developing='Parts of the program work, but important cases fail or the output is unreliable.',
                missing='The submission does not produce a working solution for the assigned problem.',
            ),
            _criterion(
                'Requirement completion',
                20,
                exceeds='All requested features, classes, methods, and submission requirements are present and complete.',
                meets='Most requirements are complete, with only a few minor omissions.',
                developing='Several required parts are only partially implemented or missing.',
                missing='Major assignment requirements are not met.',
            ),
            _criterion(
                'Design and code organization',
                15,
                exceeds='Code is organized into clear units with sensible structure, low duplication, and readable control flow.',
                meets='Code organization is generally solid, though a few sections could be simplified or structured better.',
                developing='The design works in places but shows duplication, weak decomposition, or confusing structure.',
                missing='Poor organization makes the code difficult to understand, debug, or extend.',
            ),
            _criterion(
                'Readability and documentation',
                10,
                exceeds='Naming, formatting, and comments make the solution easy to read and review.',
                meets='The code is readable overall, with a small number of style or clarity issues.',
                developing='Readability is inconsistent because of naming, formatting, or missing explanation.',
                missing='The code is hard to follow because of weak readability or absent documentation.',
            ),
            _criterion(
                'Testing and validation',
                10,
                exceeds='The submission shows clear evidence of testing, including meaningful validation of edge cases.',
                meets='The solution appears tested for common paths and basic validation is present.',
                developing='Testing appears limited and misses important scenarios.',
                missing='There is little or no evidence that the program was validated before submission.',
            ),
        ],
    },
    {
        'slug': 'programming-homework-rubric',
        'name': 'Programming Homework Rubric',
        'description': 'General-purpose rubric for weekly programming homework with clear scoring guidance for correctness, coverage, and code quality.',
        'is_weighted': False,
        'criteria': [
            _criterion(
                'Correctness',
                55,
                exceeds='Implements the required behavior correctly across normal and edge-case inputs.',
                meets='Produces the expected result for the core workflow with only minor issues or isolated mistakes.',
                developing='Solves part of the problem but misses important cases, contains repeated logic errors, or produces unstable output.',
                missing='Does not produce a working solution for the required behavior.',
            ),
            _criterion(
                'Requirements coverage',
                20,
                exceeds='Covers each assignment requirement, including formatting, constraints, and any required files or methods.',
                meets='Addresses most stated requirements with only small omissions.',
                developing='Several required elements are incomplete, missing, or only partially addressed.',
                missing='Major requirements are missing or the submission does not follow the assignment specification.',
            ),
            _criterion(
                'Code quality and readability',
                15,
                exceeds='Code is well-structured, readable, and easy to review with sensible naming and minimal duplication.',
                meets='Code is understandable overall, with a few style or organization issues that do not block review.',
                developing='Code is difficult to follow because of unclear naming, duplication, or inconsistent structure.',
                missing='Code quality issues make the solution very hard to understand or maintain.',
            ),
            _criterion(
                'Testing and edge cases',
                10,
                exceeds='Submission clearly demonstrates attention to edge cases, validation, and failure paths.',
                meets='Core test scenarios are handled and some non-happy-path behavior is considered.',
                developing='Edge cases are weakly handled or only some inputs are validated correctly.',
                missing='No meaningful handling of edge cases or invalid input is evident.',
            ),
        ],
    },
    {
        'slug': 'lab-checkpoint-rubric',
        'name': 'Lab and Checkpoint Rubric',
        'description': 'Fast grading template for labs, in-class checkpoints, and guided exercises with lightweight scoring guidance.',
        'is_weighted': False,
        'criteria': [
            _criterion(
                'Core task completion',
                50,
                exceeds='All required lab tasks are completed and behave as intended without instructor intervention.',
                meets='The main task is completed with small gaps that do not undermine the overall outcome.',
                developing='Only part of the lab is complete or key steps still require rework.',
                missing='The main checkpoint or lab objective is not complete.',
            ),
            _criterion(
                'Output accuracy',
                20,
                exceeds='Program output, formatting, and artifacts match the expected result closely.',
                meets='Output is mostly correct with only minor formatting or presentation issues.',
                developing='Output is partially correct but inconsistent or missing important information.',
                missing='Output is incorrect, missing, or unusable for grading.',
            ),
            _criterion(
                'Process and troubleshooting',
                15,
                exceeds='Student work shows clear debugging effort, incremental progress, and recovery from errors.',
                meets='There is evidence of a reasonable working process and some troubleshooting.',
                developing='Process is incomplete or suggests limited debugging and validation.',
                missing='No meaningful process or troubleshooting is visible in the submission.',
            ),
            _criterion(
                'Notes and reflection',
                15,
                exceeds='Includes concise, useful notes about what was tried, what worked, and what remains unclear.',
                meets='Includes brief notes or comments that explain the submission adequately.',
                developing='Reflection or notes are minimal and do not explain the current state well.',
                missing='No notes, reflection, or context are provided.',
            ),
        ],
    },
    {
        'slug': 'project-milestone-review',
        'name': 'Project Milestone Review',
        'description': 'Milestone rubric for larger programming projects with guidance around implementation, architecture, validation, and communication.',
        'is_weighted': False,
        'criteria': [
            _criterion(
                'Milestone scope completion',
                30,
                exceeds='The milestone deliverables are complete and clearly aligned to the planned scope.',
                meets='Most milestone goals are complete, with only minor scope left unfinished.',
                developing='A meaningful portion of the milestone is incomplete or only partially integrated.',
                missing='The milestone scope is largely unfinished or misaligned with the stated goal.',
            ),
            _criterion(
                'Design and architecture',
                20,
                exceeds='Implementation choices are cohesive, modular, and show deliberate design decisions.',
                meets='Architecture is serviceable and mostly organized, though some design decisions need refinement.',
                developing='Design is inconsistent, tightly coupled, or difficult to extend safely.',
                missing='There is little evidence of workable architecture or maintainable design.',
            ),
            _criterion(
                'Testing and validation',
                20,
                exceeds='Project includes strong evidence of validation through tests, demos, or scenario coverage.',
                meets='Validation covers the important flows, even if it is not comprehensive.',
                developing='Validation is shallow, narrow, or misses important failure paths.',
                missing='There is little or no meaningful validation of the implementation.',
            ),
            _criterion(
                'Code quality and maintainability',
                15,
                exceeds='Codebase is organized for future iteration with clear structure, naming, and manageable complexity.',
                meets='Code is generally maintainable with a few rough edges that do not block continued work.',
                developing='Complexity, duplication, or weak organization will slow future progress.',
                missing='Current code quality creates major risk for continued project development.',
            ),
            _criterion(
                'Documentation and demo readiness',
                15,
                exceeds='Submission is easy to review, demo, and discuss because setup, usage, and current status are well documented.',
                meets='Documentation and demo materials are sufficient for a review session.',
                developing='Reviewers can understand the project only with extra explanation or missing context.',
                missing='The project lacks the documentation or context needed for a useful milestone review.',
            ),
        ],
    },
]


def create_assignment_rubric_version(assignment, *, is_weighted, criteria, created_by=None):
    rubric, created = Rubric.objects.get_or_create(
        assignment=assignment,
        defaults={'created_by': created_by},
    )
    if not created and created_by and rubric.created_by_id is None:
        rubric.created_by = created_by
        rubric.save(update_fields=['created_by'])

    current_version = (
        RubricVersion.objects.filter(rubric=rubric)
        .aggregate(max_version=Max('version_number'))
        .get('max_version')
        or 0
    )
    version = RubricVersion.objects.create(
        rubric=rubric,
        version_number=current_version + 1,
        is_weighted=is_weighted,
        created_by=created_by,
    )
    for index, criterion in enumerate(criteria or []):
        criterion_obj = RubricCriterion.objects.create(
            rubric_version=version,
            name=criterion.get('name', ''),
            max_points=criterion.get('max_points', 0),
            weight=criterion.get('weight'),
            order_index=criterion.get('order_index', index),
            created_by=created_by,
        )
        for level_index, level in enumerate(criterion.get('levels') or []):
            RubricCriterionLevel.objects.create(
                criterion=criterion_obj,
                label=level.get('label', ''),
                min_points=level.get('min_points', 0),
                max_points=level.get('max_points', 0),
                description=level.get('description', ''),
                order_index=level.get('order_index', level_index),
                created_by=created_by,
            )

    rubric.active_version = version
    rubric.save(update_fields=['active_version'])
    return rubric, version


def create_rubric_template(name, *, description='', scope, course=None, template_key=None, is_weighted, criteria, created_by=None):
    template = RubricTemplate.objects.create(
        name=name,
        description=description or '',
        scope=scope,
        course=course,
        template_key=template_key,
        created_by=created_by,
    )
    version = create_rubric_template_version(
        template,
        is_weighted=is_weighted,
        criteria=criteria,
        created_by=created_by,
    )
    return template, version


def create_rubric_template_version(template, *, is_weighted, criteria, created_by=None):
    current_version = (
        RubricTemplateVersion.objects.filter(template=template)
        .aggregate(max_version=Max('version_number'))
        .get('max_version')
        or 0
    )
    version = RubricTemplateVersion.objects.create(
        template=template,
        version_number=current_version + 1,
        is_weighted=is_weighted,
        created_by=created_by,
    )
    for index, criterion in enumerate(criteria or []):
        criterion_obj = RubricTemplateCriterion.objects.create(
            template_version=version,
            name=criterion.get('name', ''),
            max_points=criterion.get('max_points', 0),
            weight=criterion.get('weight'),
            order_index=criterion.get('order_index', index),
            created_by=created_by,
        )
        for level_index, level in enumerate(criterion.get('levels') or []):
            RubricTemplateCriterionLevel.objects.create(
                criterion=criterion_obj,
                label=level.get('label', ''),
                min_points=level.get('min_points', 0),
                max_points=level.get('max_points', 0),
                description=level.get('description', ''),
                order_index=level.get('order_index', level_index),
                created_by=created_by,
            )

    template.active_version = version
    template.save(update_fields=['active_version'])
    return version


def _course_starter_template_key(course_id, slug):
    return f'course:{course_id}:{slug}'


def bootstrap_course_rubric_templates(course, *, created_by=None):
    existing_keys = set(
        RubricTemplate.objects.filter(course=course)
        .exclude(template_key__isnull=True)
        .values_list('template_key', flat=True)
    )
    created_templates = []

    for definition in COURSE_STARTER_RUBRIC_TEMPLATES:
        template_key = _course_starter_template_key(course.id, definition['slug'])
        if template_key in existing_keys:
            continue
        template, _version = create_rubric_template(
            definition['name'],
            description=definition.get('description', ''),
            scope=RubricTemplateScope.COURSE,
            course=course,
            template_key=template_key,
            is_weighted=definition.get('is_weighted', False),
            criteria=deepcopy(definition.get('criteria', [])),
            created_by=created_by,
        )
        created_templates.append(template)

    return created_templates
