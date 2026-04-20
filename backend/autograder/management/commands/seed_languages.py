from django.core.management.base import BaseCommand

from autograder.models import ProgrammingLanguage


DEFAULT_LANGUAGE_DEFINITIONS = [
    {
        'name': 'Python 3',
        'slug': 'python3',
        'docker_image': '',
        'compile_cmd': '',
        'run_cmd_template': 'python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        'is_enabled': True,
    },
    {
        'name': 'Java 17',
        'slug': 'java17',
        'docker_image': '',
        'compile_cmd': '',
        'run_cmd_template': 'python {tests_dir}/run_tests.py {submission_dir} {workspace}',
        'is_enabled': True,
    },
]


class Command(BaseCommand):
    help = 'Seed the default programming languages used by the grader.'

    def handle(self, *args, **options):
        created_count = 0
        updated_count = 0

        for definition in DEFAULT_LANGUAGE_DEFINITIONS:
            slug = definition['slug']
            language, created = ProgrammingLanguage.objects.update_or_create(
                slug=slug,
                defaults=definition,
            )
            if created:
                created_count += 1
                self.stdout.write(self.style.SUCCESS(f'Created language: {language.name} ({language.slug})'))
            else:
                updated_count += 1
                self.stdout.write(self.style.WARNING(f'Updated language: {language.name} ({language.slug})'))

        self.stdout.write(
            self.style.SUCCESS(
                f'Seed complete. Created {created_count}, updated {updated_count}, total {len(DEFAULT_LANGUAGE_DEFINITIONS)}.'
            )
        )
